import {PlatformConfig} from 'homebridge';

export interface LoginResponse {
    LoginResult: LoginResult;
}

export interface LoginResult {
    AccessToken: AccessToken;
    LoginType: number;
    ResponseStatus: ResponseStatus;
}

export interface AccessToken {
    Token: string;
}

export interface ResponseStatus {
    Messages: string[];
    Status: number;
}


export interface GetAccountIDFromEmailResponse {
    GetAccountIDFromEmailResult: GetAccountIdfromEmailResult;
}

export interface GetAccountIdfromEmailResult {
    AccountID: number;
    ResponseStatus: ResponseStatus;
}

export interface ResponseStatus {
    Messages: string[];
    Status: number;
}


export interface GetAdminControlUserForStoreResponse {
    AccessControlUserID: number;
    UserID: number;
    DisplayName: string;
    EntryCode: string;
    GuestAccountFirstname: string;
    GuestAccountLastname: string;
    GuestAccountEmail: string;
    HomeIDs: number[];
    DoorLocks: DoorLock[];
}

export interface DoorLock {
    accessControlSlotID: number;
    accessControlUserID: number;
    endpointID: number;
    slotID: number;
    accessControlTypeID: number;
    onMonday: boolean;
    onTuesday: boolean;
    onWednesday: boolean;
    onThursday: boolean;
    onFriday: boolean;
    onSaturday: boolean;
    onSunday: boolean;
    dateFrom: string;
    dateTo: string;
    timeFrom: string;
    timeTo: string;
    serializedValues: string;
    dateTimeCreated: string;
    enabled: boolean;
    synchronized: boolean;
}

export interface GetUpdatedObjectsResponse {
    responseStatus: number;
    newSerials: NewSerials;
    home: Home;
    devices: Device[];
    endpoints: Endpoint[];
    entryCode: string;
}

export interface NewSerials {
    home: number;
    devices: number;
    endpoints: number;
    endpointValues: number;
    notifications: number;
}

export interface Home {
    homeID: number;
    description: string;
    dateTimeCreated: string;
    remoteAccessKey: string;
    accountID: number;
    enabled: boolean;
    timeZoneID: number;
    devices: string;
    account: string;
    googleHomePinCode: string;
}

export interface Device {
    scriptObjectID: string;
    deviceModel: string;
    technologyID: number;
    privateKey: string;
    firmwareVersion: string;
    parameters: string;
    newFirmwareAvailable: boolean;
    numberOfEndpoints: number;
    username: string;
    deviceID: number;
    homeID: number;
    description: string;
    dateTimeCreated: string;
    deviceModelID: number;
    deviceTechID: number;
    address: string;
    currentFirmwareVersion: string;
    enabled: boolean;
    isOnline: boolean;
    automaticFirmwareUpdate: boolean;
    logicDeletionDateTime: string;
    dateTimeUpdated: string;
    password: string;
    enableNotification: boolean;
    streamingUrl: string;
    endpoints: string;
    home: string;
}

export interface Endpoint {
    scriptObjectID: string;
    deviceAddress: string;
    deviceModelDesc: string;
    functional: boolean;
    capabilities: number;
    meteringUnitID: number;
    endpointModelDesc: string;
    groups: string;
    parameters: string;
    endpointID: number;
    description: string;
    statusName: string;
    statusID: number;
    endpointType: number;
    doorlockType: number;
    doorlockTypeName: string;
    doorlockIcon: string;
    lowBattery: boolean;
    isOnline: boolean;
    deviceID: number;
    pinCode: string;
    dateTimeCreated: string;
    address: string;
    enabled: boolean;
    isEditable: boolean;
    logicDeletionDateTime: string;
    dateTimeUpdated: string;
    endpointTypeID: number;
    positionCurtain: string;
}


export interface DoorlockLockUnlockResponse {
    DoorlockLockUnlockResult: DoorlockLockUnlockResult;
}

export interface DoorlockLockUnlockResult {
    ResponseStatus: ResponseStatus;
    Result: boolean;
}

export interface ResponseStatus {
    Messages: string[];
    Status: number;
}

export interface YaleHubPlatformConfig extends PlatformConfig{
    // platform?: string;
    // name?: string;
    // token?: string;
    // credentials?: Credentials;
    homeId?: number;
    accountId?: number;
    // entryCode?: number;
    options?: ConfigOptions;
    credentials?: Credentials;
    locks?: LockDetails[];
    disablePlugin?: boolean;
}

export interface ConfigOptions {
    pushRate: number;
    refreshRate: number;
    logging: 'debug' | 'standard' | 'none';
}
export interface Credentials {
    accessToken: string;
    email: string;
    password: string;
    isValidated: boolean;
    accountId?: number;
}

export type LockDetails = Endpoint & DoorLock;

