// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useCallback, useEffect, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { PageNames } from '@bfc/shared';
import camelCase from 'lodash/camelCase';

import {
  currentProjectIdState,
  dispatcherState,
  featureFlagsState,
  userSettingsState,
  botBuilderVersionState,
} from '../recoilModel';
import { getPageName } from '../utils/getPageName';
import { useLocation } from '../utils/hooks';

import TelemetryClient from './TelemetryClient';

const { ipcRenderer } = window;

export const useInitializeLogger = () => {
  const { updateUserSettings } = useRecoilValue(dispatcherState);
  const rootProjectId = useRecoilValue(currentProjectIdState);
  const { telemetry } = useRecoilValue(userSettingsState);
  const featureFlags = useRecoilValue(featureFlagsState);
  const botBuilderVersion = useRecoilValue(botBuilderVersionState);
  const reducedFeatureFlags = Object.entries(featureFlags).reduce(
    (acc, [key, { enabled }]) => ({
      ...acc,
      [camelCase(key)]: enabled,
    }),
    {},
  );

  const {
    location: { href, pathname },
  } = useLocation();

  const page = useMemo<PageNames>(() => getPageName(pathname), [pathname]);

  TelemetryClient.setup(telemetry, {
    rootProjectId,
    page,
    sdkPackageVersion: botBuilderVersion,
    ...reducedFeatureFlags,
  });

  useEffect(() => {
    // Update user settings when the user opens the app to ensure
    // the data collection settings on the server are current
    updateUserSettings();
  }, []);

  useEffect(() => {
    ipcRenderer?.on('session-update', (_event, name) => {
      switch (name) {
        case 'session-started':
          TelemetryClient.track('SessionStarted', {
            os: window.navigator.platform,
            height: screen.height,
            width: screen.width,
            devicePixelRatio: window.devicePixelRatio,
          });
          break;
        case 'session-ended':
          TelemetryClient.track('SessionEnded');
          TelemetryClient.drain();
          break;
        default:
          break;
      }
    });
  }, []);

  useEffect(() => {
    // We're currently setting the url to the page name since the url
    // could contain sensitive data such as dialog names
    TelemetryClient.track('NavigateTo', { sectionName: page, url: page });
    TelemetryClient.pageView(page, page);
  }, [page]);

  useEffect(() => {
    // Track if Composer was opened from PVA or ABS
    if (pathname === '/projects/import' || pathname === '/projects/create') {
      const url = new URL(href);
      const source = url.searchParams.get('source');
      const payload = url.searchParams.get('payload');

      try {
        const { appId } = JSON.parse(payload || '{}');
        TelemetryClient.track('HandoffToComposerCompleted', { appId, source });
      } catch (error) {
        TelemetryClient.track('HandoffToComposerCompleted', { source });
      }
    }
  }, [pathname, href]);

  const handleBeforeUnload = useCallback(() => {
    TelemetryClient.drain();
  }, []);

  useEffect(() => {
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);
};
