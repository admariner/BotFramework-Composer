// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/** @jsx jsx */
import { jsx } from '@emotion/react';
import { useEffect, useRef } from 'react';
import formatMessage from 'format-message';
import { Stack } from '@fluentui/react/lib/Stack';
import { Link } from '@fluentui/react/lib/Link';

import { subtitle, subtext, headerText } from '../styles';
import { SettingTitle } from '../shared/SettingTitle';
import { navigateTo } from '../../../utils/navigation';

import ExternalAdapterSettings from './ExternalAdapterSettings';
import ABSChannels from './ABSChannels';

type Props = {
  projectId: string;
  scrollToSectionId?: string;
};

const AdapterSection = ({ projectId, scrollToSectionId }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current && scrollToSectionId === '#connections') {
      containerRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [scrollToSectionId]);

  return (
    <div ref={containerRef} data-testid={'adapterSectionContainer'}>
      <div css={headerText}>
        {formatMessage.rich(
          'Add connections to make your bot available in Webchat, Direct Line Speech, Microsoft Teams and more. <a>Learn more.</a>',
          {
            a: ({ children }) => (
              <Link
                key="adapters-settings-page"
                aria-label={formatMessage('Learn more on how to connect a bot to channels')}
                href={'https://aka.ms/composer-connections-learnmore'}
                target="_blank"
              >
                {children}
              </Link>
            ),
          },
        )}
      </div>
      <Stack>
        <SettingTitle>{formatMessage('Azure connections')}</SettingTitle>
        <div css={subtitle}>
          {formatMessage('Connect your bot to Microsoft Teams and WebChat, or enable DirectLine Speech.')}
        </div>
        <ABSChannels projectId={projectId} />
      </Stack>
      <Stack>
        <SettingTitle>{formatMessage('External connections')}</SettingTitle>
        <div css={subtext}>
          {formatMessage.rich(
            'Find and install more external services to your bot project in <a>package manager</a>. For further guidance, see documentation for <a2>adding external connections.</a2>',
            {
              a: ({ children }) => (
                <Link
                  key="package-adapter-settings-page"
                  onClick={() => {
                    navigateTo(`/bot/${projectId}/plugin/package-manager/package-manager`);
                  }}
                >
                  {children}
                </Link>
              ),
              a2: ({ children }) => (
                <Link
                  key="package-adapter-settings-page-learn-more"
                  href={
                    'https://docs.microsoft.com/en-us/composer/how-to-manage-packages?tabs=dotnet#connect-to-package-feeds'
                  }
                  target="_blank"
                >
                  {children}
                </Link>
              ),
            },
          )}
        </div>
        <ExternalAdapterSettings projectId={projectId} />
      </Stack>
    </div>
  );
};

export default AdapterSection;
