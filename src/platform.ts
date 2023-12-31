import superStringify from 'super-stringify';
import {readFileSync, writeFileSync} from 'fs';
import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  Service,
} from 'homebridge';
import {PLUGIN_NAME, PLATFORM_NAME} from './settings';
import {YaleConnectClient} from './yaleConnectClient';
import {DoorLock, Endpoint, LockDetails, YaleHubPlatformConfig} from './types';
import {LockMechanism} from './lock';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class YaleHubConnectPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  version = process.env.npm_package_version || '1.1.0';
  yaleHub: YaleConnectClient;
  debugMode!: boolean;
  platformLogging!: string;
  registeringDevice!: boolean;

  constructor(public readonly log: Logger, public readonly config: YaleHubPlatformConfig, public readonly api: API) {
    this.logs();
    this.yaleHub = new YaleConnectClient(this.config, this.log);

    this.debugLog(`Finished initializing platform: ${this.config.name}`);
    // only load if configured
    if (!this.config) {
      return;
    }


    // verify the config
    try {
      this.verifyConfig();
      this.yaleHub = new YaleConnectClient(this.config, this.log);
      this.debugLog('Config OK');
    } catch (e: unknown) {
      this.errorLog(`Verify Config: ${e}`);
      return;
    }
    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      this.debugLog('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      try {
        if (!this.config.credentials?.isValidated) {
          this.debugWarnLog(`isValidated: ${this.config.credentials?.isValidated}`);
          await this.validate();
        } else if (this.config.credentials?.isValidated) {
          this.debugWarnLog(`email: ${this.config.credentials.email}, accountId: ${this.config.credentials.accountId}, password: `
                        + `${this.config.credentials.password}, isValidated: ${this.config.credentials?.isValidated}`);
          this.discoverDevices();
        } else {
          this.errorLog(`accessToken: ${this.config.credentials.accessToken}, password: `
                        + `${this.config.credentials.password}, isValidated: ${this.config.credentials?.isValidated}`);
        }
      } catch (e: unknown) {
        this.errorLog(`Discover Devices 1: ${e}`);
      }
    });
  }

  /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
  configureAccessory(accessory: PlatformAccessory) {
    this.debugLog(`Loading accessory from cache: ${accessory.displayName}`);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  private readonly DEFAULT_PULL_FREQUENCY = 300;

  /**
     * Verify the config passed to the plugin is valid
     */
  verifyConfig() {
    const platformConfig = {};
    if (!this.config.options) {
      this.config.options = {logging: 'debug', refreshRate: 100, pushRate: 100};
    }

    if (this.config.options?.logging) {
      platformConfig['logging'] = this.config.options.logging;
    }
    if (this.config.options?.logging && this.config.options.refreshRate) {
      platformConfig['refreshRate'] = this.config.options.refreshRate;
    }
    if (this.config.options?.logging && this.config.options.pushRate) {
      platformConfig['pushRate'] = this.config.options.pushRate;
    }
    if (Object.entries(platformConfig).length !== 0) {
      this.infoLog(`Platform Config: ${superStringify(platformConfig)}`);
    }

    if (!this.config.options?.refreshRate) {
        this.config.options!.refreshRate! = this.DEFAULT_PULL_FREQUENCY;
        this.debugWarnLog('Using Default Refresh Rate (5 minutes).');
    }

    if (!this.config.credentials) {
      throw 'Missing Credentials';
    }
    if (!this.config.credentials.email) {
      throw 'Missing YaleHub (E-mail/Phone Number';
    }
    if (!this.config.credentials.password) {
      throw 'Missing Yale Password';
    }
  }

  /**
     * Checks teh access token, home ID and other parameters
     */
  async validate() {
    try {

      if (this.config.credentials && !this.config.credentials.isValidated) {
        await this.yaleCredentials();
        const accountId = await this.yaleHub.getAccountId();
        const accessControl = await this.yaleHub.getAdminAccessControlUserForStore();
        const homeId = accessControl.homeIds[0];
        const entryCode = accessControl.entryCode;
        this.config.homeId = homeId;
        this.config.entryCode = Number(entryCode);
        const isValidated = Boolean(accountId);
        // If validated successfully, set flag for future use, and you can now use the API
        this.config.credentials.isValidated = isValidated;
        // load in the current config
        const {pluginConfig, currentConfig} = await this.pluginConfig();
        pluginConfig.homeId = homeId;
        pluginConfig.entryCode = entryCode;
        pluginConfig.credentials.isValidated = this.config.credentials?.isValidated;
        pluginConfig.credentials.accessToken = this.config.credentials.accessToken;
        pluginConfig.accountId = accountId;

        this.debugWarnLog(`isValidated: ${pluginConfig.credentials.isValidated}`);

        // save the config, ensuring we maintain pretty json
        writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4));
        if (!isValidated) {
          return;
        } else {
          await this.discoverDevices();
        }
      }
      this.verifyConfig();
    } catch (e: unknown) {
      this.errorLog(`Validated Error: ${e}`);
    }
  }

  async yaleCredentials() {
    await this.yaleHub.login();
    this.debugLog(`Yale Credentials: ${superStringify(this.yaleHub)}`);
  }

  async pluginConfig() {
    const currentConfig = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8'));
    // check the platforms section is an array before we do array things on it
    if (!Array.isArray(currentConfig.platforms)) {
      throw new Error('Cannot find platforms array in config');
    }
    // find this plugins current config
    const pluginConfig = currentConfig.platforms.find((x: { platform: string }) => x.platform === PLATFORM_NAME);
    if (!pluginConfig) {
      throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`);
    }
    // check the .credentials is an object before doing object things with it
    if (typeof pluginConfig.credentials !== 'object') {
      throw new Error('pluginConfig.credentials is not an object');
    }
    return {pluginConfig, currentConfig};
  }

  /**
     * This method is used to discover the your location and devices.
     */
  async discoverDevices() {
    try {
      await this.yaleCredentials();

      if (!this.config.locks) {
        const locks: LockDetails[] = await this.yaleHub.getLocks();
        if (locks.length > 1) {
          this.infoLog(`Total Locks Found: ${locks.length}`);
        }
        this.debugWarnLog(`Yale Platform Config Not Set: ${superStringify(this.config.locks)}`);
        for (const device of locks) {
          this.debugLog(`device restored: ${superStringify(device)}`);
          await this.createLock(device);
        }
      } else if (this.config.locks) {
        this.debugWarnLog(`Yale Platform Config Set: ${superStringify(this.config.locks)}`);
        const devices = this.config.locks;


        this.debugLog(`Yale Lock(s): ${superStringify(devices)}`);
        for (const device of devices) {
          this.debugLog(`device created: ${superStringify(device)}`);
          await this.createLock(device);
        }
      } else {
        this.errorLog('Yale Email & Password Supplied, Issue with Auth.');
      }
    } catch (e: unknown) {
      this.errorLog(`Discover Devices 2: ${e}`);
    }
  }

  private async createLock(device: LockDetails) {
    const uuid = this.api.hap.uuid.generate(device.deviceID.toString());
    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {

      // the accessory already exists
      if (this.registerDevice(device)) {
        this.infoLog(`Restoring existing accessory from cache: ${device.description} Lock ID: ${device.deviceID}`);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device;
        existingAccessory.displayName = device.description;
        existingAccessory.context.model = device.doorlockTypeName;
        existingAccessory.context.endpointID = device.endpointID;
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new LockMechanism(this, existingAccessory, device);
        this.debugLog(`${device.description} (${device.endpointID}) uuid: ${existingAccessory.UUID}`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory, device);
      }
    } else if (this.registerDevice(device)) {
      // the accessory does not yet exist, so we need to create it
      this.infoLog(`Adding new accessory: ${device.description} Lock ID: ${device.endpointID}`);

      // create a new accessory
      const accessory = new this.api.platformAccessory(device.description, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.displayName = device.description;
      accessory.context.model = device.doorlockTypeName;
      accessory.context.endpointID = device.endpointID;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new LockMechanism(this, accessory, device);
      this.debugLog(`${device.description} (${device.endpointID}) uuid:  ${accessory.UUID}`);

      // link the accessory to your platform
      this.externalOrPlatform(device, accessory);
      this.accessories.push(accessory);
    } else {
      this.debugErrorLog(`Unable to Register new device: ${device.description} Lock ID: ${device.endpointID}`);
      this.debugErrorLog('Check Config to see if endpointID is being Hidden.');
    }
  }

  private registerDevice(device: DoorLock & Endpoint) {
    this.registeringDevice = true;
    this.debugLog(`Device: ${device.description} Enabled`);
    return this.registeringDevice;
  }

  public async externalOrPlatform(device: DoorLock & Endpoint, accessory: PlatformAccessory) {
    this.debugLog(`${accessory.displayName} Platform Accessory Mode`);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory, device: DoorLock & Endpoint) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.warnLog(`Removing existing accessory from cache: ${device.description}`);
  }

  logs() {
    this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');
    if (this.config.options && ['debug', 'standard', 'none'].includes(this.config.options.logging)) {
      this.platformLogging = this.config.options!.logging;
      if (this.platformLogging.includes('debug')) {
        this.debugWarnLog(`Using Config Logging: ${this.platformLogging}`);
      }
    } else if (this.debugMode) {
      this.platformLogging = 'debugMode';
      if (this.platformLogging?.includes('debug')) {
        this.debugWarnLog(`Using ${this.platformLogging} Logging`);
      }
    } else {
      this.platformLogging = 'standard';
      if (this.platformLogging?.includes('debug')) {
        this.debugWarnLog(`Using ${this.platformLogging} Logging`);
      }
    }
  }

  /**
     * If device level logging is turned on, log to log.warn
     * Otherwise send debug logs to log.debug
     */
  infoLog(...log: string[]) {
    if (this.enablingPlatfromLogging()) {
      this.log.info(String(...log));
    }
  }

  warnLog(...log: string[]) {
    if (this.enablingPlatfromLogging()) {
      this.log.warn(String(...log));
    }
  }

  debugWarnLog(...log: string[]): void {
    if (this.enablingPlatfromLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.warn('[DEBUG]', String(...log));
      }
    }
  }

  errorLog(...log: string[]) {
    if (this.enablingPlatfromLogging()) {
      this.log.error(String(...log));
    }
  }

  debugErrorLog(...log: string[]): void {
    if (this.enablingPlatfromLogging()) {
      if (this.platformLogging?.includes('debug')) {
        this.log.error('[DEBUG]', String(...log));
      }
    }
  }

  debugLog(...log: string[]) {
    if (this.enablingPlatfromLogging()) {
      if (this.platformLogging === 'debugMode') {
        this.log.debug(String(...log));
      } else if (this.platformLogging === 'debug') {
        this.log.info('[DEBUG]', String(...log));
      }
    }
  }

  enablingPlatfromLogging(): boolean {
    return this.platformLogging?.includes('debug') || this.platformLogging === 'standard';
  }
}