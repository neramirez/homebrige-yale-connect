import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {interval, Subject} from 'rxjs';
import {debounceTime, skipWhile, take, tap} from 'rxjs/operators';
import superStringify from 'super-stringify';
import {YaleHubConnectPlatform} from './platform';
import {DoorLock, Endpoint} from './types';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LockMechanism {
  lockService?: Service;
  batteryService!: Service;


  // CharacteristicValue
  LockTargetState!: CharacteristicValue;
  LockCurrentState!: CharacteristicValue;
  StatusLowBattery!: CharacteristicValue;

  // Lock Status
  state!: string;
  locked!: boolean;
  unlocked!: boolean;

  // Lock Details
  isLowBattery!: boolean;

  // Config
  deviceLogging!: string;
  // Lock Updates
  lockUpdateInProgress: boolean;
  doLockUpdate: Subject<void>;

  constructor(private readonly platform: YaleHubConnectPlatform, private accessory: PlatformAccessory, public device: DoorLock & Endpoint) {
    this.device = device;
    // this.deviceRefreshRate = this.
    this.logs();
    this.cacheState();

    // default placeholders
    // this is subject we use to track when we need to POST changes to the Yale Hub API
    this.doLockUpdate = new Subject();
    this.lockUpdateInProgress = false;

    // Initial Device Parse
    this.refreshStatus();

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Yale Home Inc.')
      .setCharacteristic(this.platform.Characteristic.Model, this.device.doorlockTypeName);

    // Lock Mechanism Service
    if (!this.lockService) {
      this.debugLog(`Lock: ${accessory.displayName} Add Lock Mechanism Service`);
      this.lockService =
                this.accessory.getService(this.platform.Service.LockMechanism) ||
                this.accessory.addService(this.platform.Service.LockMechanism);
      // Service Name
      this.lockService.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
      //Required Characteristics" see https://developers.homebridge.io/#/service/LockMechanism

      // Create handlers for required characteristics
      this.lockService.getCharacteristic(this.platform.Characteristic.LockTargetState).onSet(this.setLockTargetState.bind(this));
    } else {
      this.warnLog(`Lock: ${accessory.displayName} Lock Mechanism Service Not Added`);
    }

    // Battery Service
    this.batteryService =
            this.accessory.getService(this.platform.Service.Battery) ||
            this.accessory.addService(this.platform.Service.Battery);

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics();

    // Subscribe to yale changes
    this.subscribeYaleHub();

    // Start an update interval
    interval(this.platform.config.options!.refreshRate * 1000)
      .pipe(skipWhile(() => this.lockUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus();
      });

    // Watch for Lock change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    this.doLockUpdate
      .pipe(
        tap(() => {
          this.lockUpdateInProgress = true;
        }),
        debounceTime(100),
      )
      .subscribe(async () => {
        try {
          await this.pushChanges();
          await this.refreshStatus();
        } catch (e: unknown) {
          this.errorLog(`doLockUpdate pushChanges: ${e}`);
        }
        // Refresh the status from the API
        interval(this.platform.config.options!.refreshRate * 1000)
          .pipe(skipWhile(() => this.lockUpdateInProgress))
          .pipe(take(1))
          .subscribe(async () => {
            await this.refreshStatus();
          });
        this.lockUpdateInProgress = false;
      });
  }

  /**
     * Parse the device status from the Yale Hub api
     */
  async parseStatus(): Promise<void> {
    this.debugLog(`Lock: ${this.accessory.displayName} parseStatus`);

    // Lock Mechanism
    if (this.locked) {
      this.LockCurrentState = this.platform.Characteristic.LockCurrentState.SECURED;
    } else if (this.unlocked) {
      this.LockCurrentState = this.platform.Characteristic.LockCurrentState.UNSECURED;
    } else {
      this.LockCurrentState = this.platform.Characteristic.LockCurrentState.UNKNOWN;
      //this.refreshStatus();
    }
    // Battery
    if (this.isLowBattery) {
      this.StatusLowBattery = this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    } else {
      this.StatusLowBattery = this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
    this.debugLog(`Lock: ${this.accessory.displayName} StatusLowBattery: ${this.StatusLowBattery}`);

  }

  /**
     * Asks the Yale Hub API for the latest device information
     */
  async refreshStatus(): Promise<void> {
    this.infoLog('Refreshing status');
    try {
      // Update Lock Status
      const lockStatuses = await this.platform.yaleHub.getLocks();
      const lockStatus = lockStatuses.find(lock => lock.endpointID === this.device.endpointID);
      this.debugLog(`Lock: ${this.accessory.displayName} lockStatus (refreshStatus): ${superStringify(lockStatus)}`);
      if (lockStatus) {
        this.debugLog(`LockStatus: ${this.accessory.displayName} ${lockStatus.statusName}`);
        this.state = lockStatus.statusName;
        this.locked = lockStatus.statusName === 'Close';
        this.unlocked = lockStatus.statusName === 'Open';
        this.isLowBattery = lockStatus.lowBattery;
      } else {
        this.debugErrorLog(`Lock: ${this.accessory.displayName} lockStatus (refreshStatus): ${superStringify(lockStatus)}`);
      }
      // Update Lock Details
      const lockDetails = await this.platform.yaleHub.details(this.device.endpointID);
      if (lockDetails) {

        this.debugLog(`Lock: ${this.accessory.displayName} lockDetails (refreshStatus): ${superStringify(lockDetails)}`);
        this.debugLog(`Lock: ${this.accessory.displayName} battery (lockDetails): ${this.isLowBattery}`);
      } else {
        this.debugErrorLog(`Lock: ${this.accessory.displayName} lockDetails (refreshStatus): ${superStringify(lockDetails)}`);
      }
      // Update HomeKit
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: unknown) {
      if (e instanceof Error) {

        this.errorLog(`refreshStatus: ${e}`);
        this.errorLog(`Lock: ${this.accessory.displayName} failed lockStatus (refreshStatus), Error Message: ${superStringify(e.message)}`);
      }
    }
  }

  /**
     * Pushes the requested changes to the Yale API
     */
  async pushChanges(): Promise<void> {
    try {
      if (this.LockTargetState === this.platform.Characteristic.LockTargetState.UNSECURED) {
        this.debugWarnLog(`Lock: ${this.accessory.displayName} Sending request to Yale Hub API: Unlock (${this.LockTargetState})`);
        const lockStatus = await this.platform.yaleHub.unlock(this.device.endpointID);
        this.debugWarnLog(`Lock: ${this.accessory.displayName} (pushChanges-unlock) status: ${superStringify(lockStatus)}`);
      } else if (this.LockTargetState === this.platform.Characteristic.LockTargetState.SECURED) {
        this.debugWarnLog(`Lock: ${this.accessory.displayName} Sending request to Yale Hub API: Lock (${this.LockTargetState})`);
        const lockStatus = await this.platform.yaleHub.lock(this.device.endpointID);
        this.debugWarnLog(`Lock: ${this.accessory.displayName} (pushChanges-lock) status: ${superStringify(lockStatus)}`);
      } else {
        this.errorLog(`Lock: ${this.accessory.displayName} lockStatus (pushChanges) failed, this.LockTargetState: ${this.LockTargetState}`);
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        this.errorLog(`pushChanges: ${e}`);
        this.errorLog(`Lock: ${this.accessory.displayName} failed pushChanges, Error Message: ${superStringify(e.message)}`);
      }
    }
  }

  /**
     * Updates the status for each of the HomeKit Characteristics
     */
  async updateHomeKitCharacteristics(): Promise<void> {
    this.debugLog('Updating characteristics');
    // Lock Mechanism
    if (this.LockTargetState === undefined) {
      this.debugLog(`Lock: ${this.accessory.displayName} LockTargetState: ${this.LockTargetState}`);
    } else {
      this.accessory.context.LockCurrentState = this.LockTargetState;
      this.lockService?.updateCharacteristic(this.platform.Characteristic.LockTargetState, this.LockTargetState);
      this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic LockTargetState: ${this.LockTargetState}`);
    }
    if (this.LockCurrentState === undefined) {
      this.debugLog(`Lock: ${this.accessory.displayName} LockCurrentState: ${this.LockCurrentState}`);
    } else {
      this.accessory.context.LockCurrentState = this.LockCurrentState;
      this.lockService?.updateCharacteristic(this.platform.Characteristic.LockCurrentState, this.LockCurrentState);
      this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic LockCurrentState: ${this.LockCurrentState}`);
    }
    // Battery

    if (this.StatusLowBattery === undefined) {
      this.debugLog(`Lock: ${this.accessory.displayName} StatusLowBattery: ${this.StatusLowBattery}`);
    } else {
      this.accessory.context.StatusLowBattery = this.StatusLowBattery;
      this.batteryService.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.StatusLowBattery);
      this.debugLog(`Lock: ${this.accessory.displayName} updateCharacteristic StatusLowBattery: ${this.StatusLowBattery}`);
    }
  }

  async setLockTargetState(value: CharacteristicValue): Promise<void> {
    this.debugLog(`Lock: ${this.accessory.displayName} Set LockTargetState: ${value}`);
    this.LockTargetState = value;
    this.accessory.context.LockTargetState = this.LockTargetState;
    this.doLockUpdate.next();
    if (this.LockCurrentState === this.platform.Characteristic.LockCurrentState.UNSECURED) {
      this.infoLog(`Lock: ${this.accessory.displayName} was Unlocked`);
    }
    if (this.LockCurrentState === this.platform.Characteristic.LockCurrentState.SECURED) {
      this.infoLog(`Lock: ${this.accessory.displayName} was Locked`);
    }
  }

  async subscribeYaleHub(): Promise<void> {
    // await this.platform.yaleHub.subscribe(this.device.endpointId, (YaleEvent: any, timestamp: any) => {
    //   this.debugLog(`Lock: ${this.accessory.displayName} YaleEvent: ${superStringify(YaleEvent), superStringify(timestamp)}`);
    //   //LockCurrentState
    //   if (YaleEvent.state.unlocked) {
    //     this.LockCurrentState = this.platform.Characteristic.LockCurrentState.UNSECURED;
    //     if (this.LockCurrentState !== this.accessory.context.LockCurrentState) {
    //       this.infoLog(`Lock: ${this.accessory.displayName} was Unlocked`);
    //     }
    //   } else if (YaleEvent.state.locked) {
    //     this.LockCurrentState = this.platform.Characteristic.LockCurrentState.SECURED;
    //     if (this.LockCurrentState !== this.accessory.context.LockCurrentState) {
    //       this.infoLog(`Lock: ${this.accessory.displayName} was Locked`);
    //     }
    //   } else {
    //     this.refreshStatus();
    //   }
    //   // Update HomeKit
    //   this.updateHomeKitCharacteristics();
    // });
  }


  async cacheState() {
    if (this.LockCurrentState === undefined) {
      this.LockCurrentState = this.accessory.context.LockCurrentState | this.platform.Characteristic.LockCurrentState.SECURED;
    }
    if (this.LockTargetState === undefined) {
      this.LockTargetState = this.accessory.context.LockTargetState | this.platform.Characteristic.LockTargetState.SECURED;
    }

    if (this.StatusLowBattery === undefined) {
      if (this.isLowBattery) {
        this.StatusLowBattery = this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
      } else {
        this.StatusLowBattery = this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      }
    }
  }


  async logs(): Promise<void> {
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (this.platform.config.options?.logging) {
      this.deviceLogging = this.accessory.context.logging = this.platform.config.options?.logging;
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      this.debugWarnLog(`Lock: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  /**
     * Logging for Device
     */
  infoLog(...log: string[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.info(String(...log));
    }
  }

  warnLog(...log: string[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.warn(String(...log));
    }
  }

  debugWarnLog(...log: string[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.platform.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  errorLog(...log: string[]): void {
    if (this.enablingDeviceLogging()) {
      this.platform.log.error(String(...log));
    }
  }

  debugErrorLog(...log: string[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging?.includes('debug')) {
        this.platform.log.error('[DEBUG]', String(...log));
      }
    }
  }

  debugLog(...log: string[]): void {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.platform.log.info('[DEBUG]', String(...log));
      } else {
        this.platform.log.debug(String(...log));
      }
    }
  }

  enablingDeviceLogging(): boolean {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}