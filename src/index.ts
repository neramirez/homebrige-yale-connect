import { API } from 'homebridge';
import { YaleHubConnectPlatform } from './platform';
import { PLATFORM_NAME } from './settings';

/**
 * This method registers the platform with Homebridge
 */
export = (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, YaleHubConnectPlatform);
};
