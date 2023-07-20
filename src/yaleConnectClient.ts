import {Logger} from 'homebridge';
import superStringify from 'super-stringify';

import axios from 'axios';
import {
  DoorlockLockUnlockResponse,
  GetAccountIDFromEmailResponse, GetAdminControlUserForStoreResponse,
  GetUpdatedObjectsResponse, LockDetails,
  LoginResponse,
  LoginResult, YaleHubPlatformConfig,
} from './types';
import _ from 'lodash';

export class YaleConnectClient {

  private readonly baseURLApiNet = 'https://apinet-prod.yaleconnect-services.com/api/YaleConnect';
  private readonly baseURLAssaBloy = 'https://yaleconnect-services.assaabloy.com/1.0';

  constructor(private readonly config: YaleHubPlatformConfig, private readonly log: Logger) {
    this.log = log;
  }

  async login() {
    const postData = {
      'token': {
        'Token': this.config.token,
      },
      'eMail': this.config.credentials?.email,
      'password': this.config.credentials?.password,
    };
    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: this.baseURLAssaBloy + '//HomeCloudServiceAdmin.svc/Login',
      headers: {
        'content-type': 'application/json; charset="UTF-8"',
        'origin': 'https://yaleconnect-services.assaabloy.com',
        'pragma': 'no-cache',
        'referer': 'https://yaleconnect-services.assaabloy.com/yaleconnect/login',
      },
      data: postData,
    };

    const response = await axios.request<LoginResponse>(config);
    const loginResult: LoginResult = response.data.LoginResult;
    this.log.debug(`Login result ${loginResult}`);
    if (loginResult.ResponseStatus.Status !== 0) {
      throw new Error('Unable to initilize Yale Connect Client due ' + JSON.stringify(loginResult.ResponseStatus));
    }
    if (this.config.credentials) {
      this.config.credentials.accessToken = loginResult.AccessToken.Token;
    }
  }

  async getAccountId() {
    this.log.debug(`Calling getAccountId with ${this.config.credentials?.accessToken} ${this.config.credentials?.email}`);
    const data = {
      'token': {'Token': this.config.credentials?.accessToken},
      'email': this.config.credentials?.email,
    };

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: this.baseURLAssaBloy + '//HomeCloudService.svc/GetAccountIDFromEmail',
      headers: {
        'content-type': 'application/json; charset="UTF-8"',
        'origin': 'https://yaleconnect-services.assaabloy.com',
        'pragma': 'no-cache',
        'referer': 'https://yaleconnect-services.assaabloy.com/yaleconnect/login',
      },
      data: data,
    };
    const response = await axios.request<GetAccountIDFromEmailResponse>(config);
    const getAccountIdResult = response.data.GetAccountIDFromEmailResult;
    this.config.accountId = getAccountIdResult.AccountID;
    return getAccountIdResult.AccountID;
  }


  private async doorlockLockUnlock(isLocked, endpointID) {
    const data = {
      'token': {
        'Token': this.config.credentials?.accessToken,
      },
      'endpointID': endpointID,
      'isLocked': isLocked,
      'entryCode': this.config.entryCode,
    };

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `${this.baseURLAssaBloy}//HomeCloudCommandService.svc/DoorlockLockUnlock`,
      headers: {
        'authority': 'yaleconnect-services.assaabloy.com',
        'content-type': 'application/json',
        'origin': 'https://yaleconnect-services.assaabloy.com',
        'pragma': 'no-cache',
        'referer': 'https://yaleconnect-services.assaabloy.com/yaleconnect/home-list',
      },
      data: data,
    };

    const response = await axios.request<DoorlockLockUnlockResponse>(config);
    return response.data;
  }

  async getAdminAccessControlUserForStore() {
    this.log.debug(`Calling getAdminAccessControlUserForStore with ${this.config.accountId}, ${this.config.credentials?.accessToken}`);
    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: `${this.baseURLApiNet}/Account/GetAdminAccessControlUserForStore?AccountID=${this.config.accountId}`,
      headers: {
        'content-type': 'application/json; charset="UTF-8"',
        'origin': 'https://yaleconnect-services.assaabloy.com',
        'pragma': 'no-cache',
        'referer': 'https://yaleconnect-services.assaabloy.com/yaleconnect/login',
        'access-token': this.config.credentials?.accessToken,
      },
    };

    const response = await axios.request<GetAdminControlUserForStoreResponse>(config);
    const doorLocks = response.data.DoorLocks;
    //return response.data.DoorLocks;
    return {locksByEndpointId: _.groupBy(doorLocks, 'endpointID'), homeIds: response.data.HomeIDs};
  }

  async getUpdatedObjects() {
    this.log.debug(`Calling getUpdatedObjects with ${this.config.homeId}, ${this.config.credentials?.accessToken}`);
    const params = '&homeSR=0&deviceSR=0&endpointSR=0&endpointValuesSR=0&notificationSR=0';
    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: `${this.baseURLApiNet}/App/GetUpdatedObjects?homeId=${this.config.homeId}${params}`,
      headers: {
        'content-type': 'application/json; charset="UTF-8"',
        'origin': 'https://yaleconnect-services.assaabloy.com',
        'pragma': 'no-cache',
        'referer': 'https://yaleconnect-services.assaabloy.com/yaleconnect/login',
        'access-token': this.config.credentials?.accessToken,
      },
    };

    const response = await axios.request<GetUpdatedObjectsResponse>(config);
    return _.groupBy(response.data.endpoints, 'endpointID');
  }

  async unlock(endpointID) {
    return await this.doorlockLockUnlock(false, endpointID);
  }

  async lock(endpointID) {
    return await this.doorlockLockUnlock(true, endpointID);
  }


  async getLocks(): Promise<LockDetails[]> {
    const locks = await this.getAdminAccessControlUserForStore();
    this.log.debug(`Locks: ${superStringify(locks)}`);

    const lockUpdates = await this.getUpdatedObjects();
    this.log.debug(`Lock Updates: ${superStringify(lockUpdates)}`);

    const endpoints = Object.keys(locks.locksByEndpointId);

    const groupedEndpoints = endpoints.map((endpoint) => {
      const lockEndpointNumber = Number(endpoint);
      this.log.debug(`Merging endpoint: ${lockEndpointNumber}`);
      const doorLock = locks.locksByEndpointId[lockEndpointNumber][0];
      this.log.debug(`Doorlock ${superStringify(doorLock)}`);
      const lockUpdate = lockUpdates[lockEndpointNumber][0];
      this.log.debug(`Lock Updated status ${superStringify(lockUpdate)}`);
      return {...doorLock, ...lockUpdate};
    }).flat();
    this.log.debug(`Locks merged ${superStringify(groupedEndpoints)}`);
    return groupedEndpoints;

  }

  async details(endpointID) {
    const locks = await this.getLocks();
    return locks.find(lock => lock.endpointID === endpointID);
  }
}