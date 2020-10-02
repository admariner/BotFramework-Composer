// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from 'path';

import { v4 as uuid } from 'uuid';
import md5 from 'md5';
import { copy, rmdir, emptyDir, readJson, pathExists, writeJson, mkdirSync, writeFileSync } from 'fs-extra';
import { IBotProject } from '@bfc/shared';
import { JSONSchema7 } from '@bfc/extension';
import { Debugger } from 'debug';

import { mergeDeep } from './mergeDeep';
import { BotProjectDeploy } from './deploy';
import { BotProjectProvision } from './provision';
import schema from './schema';

// This option controls whether the history is serialized to a file between sessions with Composer
// set to TRUE for history to be saved to disk
// set to FALSE for history to be cached in memory only
const PERSIST_HISTORY = false;

const instructions = `To create a publish configuration, follow the instructions in the README file in your bot project folder.`;

interface DeployResources {
  name: string;
  environment: string;
  accessToken: string;
  hostname?: string;
  luisResource?: string;
  subscriptionID: string;
}

interface PublishConfig {
  fullSettings: any;
  profileName: string; //profile name
  [key: string]: any;
}

interface ResourceType {
  key: string;
  // other keys TBD
  [key: string]: any;
}

interface ProvisionConfig {
  name: string; // profile name
  type: string; // webapp or function
  subscription: { subscriptionId: string; tenantId: string; displayName: string };
  hostname: string; // for previous bot, it's ${name}-${environment}
  location: { id: string; name: string; displayName: string };
  externalResources: ResourceType[];
  choice: string;
  accessToken: string;
  graphToken: string;
  [key: string]: any;
}

// Wrap the entire class definition in the export so the composer object can be available to it
export default async (composer: any): Promise<void> => {
  class AzurePublisher {
    private publishingBots: { [key: string]: any };
    private provisionStatus: { [key: string]: any };
    private historyFilePath: string;
    private histories: any;
    private logMessages: any[];
    private mode: string;
    public schema: JSONSchema7;
    public instructions: string;
    public customName: string;
    public customDescription: string;
    public logger: Debugger;
    public hasView = true;

    constructor(mode?: string, customName?: string, customDescription?: string) {
      this.histories = {};
      this.historyFilePath = path.resolve(__dirname, '../publishHistory.txt');
      if (PERSIST_HISTORY) {
        this.loadHistoryFromFile();
      }
      this.publishingBots = {};
      this.provisionStatus = {};
      this.logMessages = [];
      this.mode = mode || 'azurewebapp';
      this.schema = schema;
      this.instructions = instructions;
      this.customName = customName;
      this.customDescription = customDescription;
      this.logger = composer.log;
    }

    private baseRuntimeFolder = process.env.AZURE_PUBLISH_PATH || path.resolve(__dirname, `../publishBots`);

    /*******************************************************************************************************************************/
    /* These methods generate all the necessary paths to various files  */
    /*******************************************************************************************************************************/

    // path to working folder containing all the assets
    private getRuntimeFolder = (key: string) => {
      return path.resolve(this.baseRuntimeFolder, `${key}`);
    };

    // path to the runtime code inside the working folder
    private getProjectFolder = (key: string, template: string) => {
      return path.resolve(this.baseRuntimeFolder, `${key}/${template}`);
    };

    // path to the declarative assets
    private getBotFolder = (key: string, template: string) =>
      path.resolve(this.getProjectFolder(key, template), 'ComposerDialogs');

    /*******************************************************************************************************************************/
    /* These methods deal with the publishing history displayed in the Composer UI */
    /*******************************************************************************************************************************/
    private async loadHistoryFromFile() {
      if (await pathExists(this.historyFilePath)) {
        this.histories = await readJson(this.historyFilePath);
      }
    }

    private getHistory = async (botId: string, profileName: string) => {
      if (this.histories && this.histories[botId] && this.histories[botId][profileName]) {
        return this.histories[botId][profileName];
      }
      return [];
    };

    private updateHistory = async (botId: string, profileName: string, newHistory: any) => {
      if (!this.histories[botId]) {
        this.histories[botId] = {};
      }
      if (!this.histories[botId][profileName]) {
        this.histories[botId][profileName] = [];
      }
      this.histories[botId][profileName].unshift(newHistory);
      if (PERSIST_HISTORY) {
        await writeJson(this.historyFilePath, this.histories);
      }
    };

    /*******************************************************************************************************************************/
    /* These methods implement the publish actions */
    /*******************************************************************************************************************************/
    /**
     * Prepare a bot to be built and deployed by copying the runtime and declarative assets into a temporary folder
     * @param project
     * @param settings
     * @param srcTemplate
     * @param resourcekey
     */
    private init = async (project: any, srcTemplate: string, resourcekey: string, runtime: any) => {
      // point to the declarative assets (possibly in remote storage)
      const botFiles = project.getProject().files;
      const botFolder = this.getBotFolder(resourcekey, this.mode);
      const runtimeFolder = this.getRuntimeFolder(resourcekey);

      // clean up from any previous deploys
      await this.cleanup(resourcekey);

      // create the temporary folder to contain this project
      mkdirSync(runtimeFolder, { recursive: true });

      // create the ComposerDialogs/ folder
      mkdirSync(botFolder, { recursive: true });

      let manifestPath;
      for (const file of botFiles) {
        const pattern = /manifests\/[0-9A-z-]*.json/;
        if (file.relativePath.match(pattern)) {
          manifestPath = path.dirname(file.path);
        }
        // save bot files
        const filePath = path.resolve(botFolder, file.relativePath);
        if (!(await pathExists(path.dirname(filePath)))) {
          mkdirSync(path.dirname(filePath), { recursive: true });
        }
        writeFileSync(filePath, file.content);
      }

      // save manifest
      runtime.setSkillManifest(runtimeFolder, project.fileStorage, manifestPath, project.fileStorage, this.mode);

      // copy bot and runtime into projFolder
      await copy(srcTemplate, runtimeFolder);
    };

    /**
     * Remove any previous version of a project's working files
     * @param resourcekey
     */
    private async cleanup(resourcekey: string) {
      const projFolder = this.getRuntimeFolder(resourcekey);
      await emptyDir(projFolder);
      await rmdir(projFolder);
    }

    /**
     * Take the project from a given folder, build it, and push it to Azure.
     * @param project
     * @param runtime
     * @param botId
     * @param profileName
     * @param jobId
     * @param resourcekey
     * @param customizeConfiguration
     */
    private performDeploymentAction = async (
      project: IBotProject,
      settings: any,
      runtime: any,
      botId: string,
      profileName: string,
      jobId: string,
      resourcekey: string,
      customizeConfiguration: DeployResources
    ) => {
      const { subscriptionID, accessToken, name, environment, hostname, luisResource } = customizeConfiguration;
      try {
        // Create the BotProjectDeploy object, which is used to carry out the deploy action.
        const azDeployer = new BotProjectDeploy({
          subId: subscriptionID, // deprecate - not used
          logger: (msg: any) => {
            this.logger(msg);
            this.logMessages.push(JSON.stringify(msg, null, 2));

            // update the log messages provided to Composer via the status API.
            const status = this.getLoadingStatus(botId, profileName, jobId);
            status.result.log = this.logMessages.join('\n');

            this.updateLoadingStatus(botId, profileName, jobId, status);
          },
          accessToken: accessToken,
          projPath: this.getProjectFolder(resourcekey, this.mode),
          runtime: runtime,
        });

        // Perform the deploy
        await azDeployer.deploy(project, settings, profileName, name, environment, hostname, luisResource);

        // update status and history
        const status = this.getLoadingStatus(botId, profileName, jobId);

        if (status) {
          status.status = 200;
          status.result.message = 'Success';
          status.result.log = this.logMessages.join('\n');
          await this.updateHistory(botId, profileName, { status: status.status, ...status.result });
          this.removeLoadingStatus(botId, profileName, jobId);
          await this.cleanup(resourcekey);
        }
      } catch (error) {
        this.logger(error);
        if (error instanceof Error) {
          this.logMessages.push(error.message);
        } else if (typeof error === 'object') {
          this.logMessages.push(JSON.stringify(error));
        } else {
          this.logMessages.push(error);
        }
        // update status and history
        const status = this.getLoadingStatus(botId, profileName, jobId);
        if (status) {
          status.status = 500;
          status.result.message = this.logMessages[this.logMessages.length - 1];
          status.result.log = this.logMessages.join('\n');
          await this.updateHistory(botId, profileName, { status: status.status, ...status.result });
          this.removeLoadingStatus(botId, profileName, jobId);
          await this.cleanup(resourcekey);
        }
      }
    };

    /*******************************************************************************************************************************/
    /* These methods help to track the process of the deploy and provide info to Composer */
    /*******************************************************************************************************************************/

    private addLoadingStatus = (botId: string, profileName: string, newStatus) => {
      // save in publishingBots
      if (!this.publishingBots[botId]) {
        this.publishingBots[botId] = {};
      }
      if (!this.publishingBots[botId][profileName]) {
        this.publishingBots[botId][profileName] = [];
      }
      this.publishingBots[botId][profileName].push(newStatus);
    };

    private removeLoadingStatus = (botId: string, profileName: string, jobId: string) => {
      if (this.publishingBots[botId] && this.publishingBots[botId][profileName]) {
        const index = this.publishingBots[botId][profileName].findIndex((item) => item.result.id === jobId);
        const status = this.publishingBots[botId][profileName][index];
        this.publishingBots[botId][profileName] = this.publishingBots[botId][profileName]
          .slice(0, index)
          .concat(this.publishingBots[botId][profileName].slice(index + 1));
        return status;
      }
      return;
    };

    private getLoadingStatus = (botId: string, profileName: string, jobId = '') => {
      if (this.publishingBots[botId] && this.publishingBots[botId][profileName].length > 0) {
        // get current status
        if (jobId) {
          return this.publishingBots[botId][profileName].find((item) => item.result.id === jobId);
        }
        return this.publishingBots[botId][profileName][this.publishingBots[botId][profileName].length - 1];
      }
      return undefined;
    };

    private updateLoadingStatus = (botId: string, profileName: string, jobId = '', newStatus) => {
      if (this.publishingBots[botId] && this.publishingBots[botId][profileName].length > 0) {
        // get current status
        if (jobId) {
          for (let x = 0; x < this.publishingBots[botId][profileName].length; x++) {
            if (this.publishingBots[botId][profileName][x].result.id === jobId) {
              this.publishingBots[botId][profileName][x] = newStatus;
            }
          }
        } else {
          this.publishingBots[botId][profileName][this.publishingBots[botId][profileName].length - 1] = newStatus;
        }
      }
    };

    /*******************************************************************************************************************************/
    /* These methods help to track the process of the provision (create azure resources for deploy) */
    /*******************************************************************************************************************************/
    private setProvisionStatus = (botId: string, profileName: string, newStatus) => {
      if (!this.provisionStatus[botId]) {
        this.provisionStatus[botId] = {};
      }
      this.provisionStatus[botId][profileName] = newStatus;
    };

    private asyncProvision = async (config: ProvisionConfig, project, user) => {
      const { hostname, subscription, accessToken, graphToken, location } = config;

      console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> azure provision process begins', config);

      // Create the object responsible for actually taking the provision actions.
      const azureProvisioner = new BotProjectProvision({
        subscriptionId: subscription.subscriptionId,
        logger: (msg: any) => {
          console.log(msg);
          this.logMessages.push(JSON.stringify(msg, null, 2));
        },
        accessToken: accessToken,
        graphToken: graphToken,
        tenantId: subscription.tenantId, // does the tenantId ever come back from the subscription API we use? it does not appear in my tests.
      });

      // set interval to update status
      const updatetimer = setInterval(() => {
        if (this.provisionStatus[project.id][config.name]) {
          this.provisionStatus[project.id][config.name].details = azureProvisioner.getProvisionStatus();
        } else {
          this.provisionStatus[project.id][config.name] = {
            status: 202,
            details: azureProvisioner.getProvisionStatus(),
          };
        }
      }, 10000);

      // perform the provision using azureProvisioner.create.
      // this will start the process, then return.
      // However, the process will continue in the background and report its status changes using azureProvisioner.getProvisionStatus().
      // DO NOT AWAIT THIS, since it needs to continue in the background...
      console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> call to azureProvisioner.create! ');
      // const previous = this.provisionStatus[project.id][config.name];
      // previous.status = 200;
      // previous.config = result;
      // previous.details = azureProvisioner.getProvisionStatus();
      // this.setProvisionStatus(project.id, config.name, previous);
      // console.log(result);
      // return result;

      azureProvisioner
        .create(config)
        .then((provisionResults) => {
          // GOT PROVISION RESULTS!
          // cast this into the right form for a publish profile
          const publishProfile = {
            name: config.hostname,
            environment: '',
            settings: {
              applicationInsights: {
                InstrumentationKey: provisionResults.appInsights?.instrumentationKey,
              },
              cosmosDb: provisionResults.cosmoDB,
              blobStorage: provisionResults.blobStorage,
              luis: {
                authoringKey: provisionResults.luisAuthoring?.authoringKey,
                authoringEndpoint: provisionResults.luisAuthoring?.authoringEndpoint,
                endpointKey: provisionResults.luisPrediction?.endpointKey,
                endpoint: provisionResults.luisPrediction?.endpoint,
                region: provisionResults.resourceGroup.location,
              },
              MicrosoftAppId: provisionResults.appId,
              MicrosoftAppPassword: provisionResults.appPassword,
              hostname: config.hostname,
            },
          };

          console.log('PUBLISH PROFILE', publishProfile);

          // write this to the project settings.
        })
        .catch((error) => {
          console.log(error);

          const previous = this.provisionStatus[project.id][config.name];
          previous.status = 500;
          previous.config = {};
          previous.details = azureProvisioner.getProvisionStatus();
          previous.error = JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)));

          this.setProvisionStatus(project.id, config.name, previous);
        })
        .finally(() => {
          clearInterval(updatetimer);
        });
    };

    /*******************************************************************************************************************************/
    /* These methods deploy bot to azure async */
    /*******************************************************************************************************************************/
    // move the init folder and publsih together and not wait in publish method. because init folder take a long time
    private asyncPublish = async (config: PublishConfig, project, resourcekey, jobId) => {
      const {
        // these are provided by Composer
        fullSettings, // all the bot's settings - includes sensitive values not included in projet.settings
        profileName, // the name of the publishing profile "My Azure Prod Slot"

        // these are specific to the azure publish profile shape
        subscriptionID,
        name,
        environment,
        hostname,
        luisResource,
        defaultLanguage,
        settings,
        accessToken,
      } = config;

      // get the appropriate runtime template which contains methods to build and configure the runtime
      const runtime = composer.getRuntimeByProject(project);
      // set runtime code path as runtime template folder path
      let runtimeCodePath = runtime.path;

      // If the project is using an "ejected" runtime, use that version of the code instead of the built-in template
      // TODO: this templatePath should come from the runtime instead of this magic parameter
      if (
        project.settings &&
        project.settings.runtime &&
        project.settings.runtime.customRuntime === true &&
        project.settings.runtime.path
      ) {
        runtimeCodePath = project.settings.runtime.path;
      }

      // Prepare the temporary project
      // this writes all the settings to the root settings/appsettings.json file
      await this.init(project, runtimeCodePath, resourcekey, runtime);

      // Merge all the settings
      // this combines the bot-wide settings, the environment specific settings, and 2 new fields needed for deployed bots
      // these will be written to the appropriate settings file inside the appropriate runtime plugin.
      const mergedSettings = mergeDeep(fullSettings, settings);

      // Prepare parameters and then perform the actual deployment action
      const customizeConfiguration: DeployResources = {
        accessToken,
        subscriptionID,
        name,
        environment,
        hostname,
        luisResource,
      };
      await this.performDeploymentAction(
        project,
        mergedSettings,
        runtime,
        project.id,
        profileName,
        jobId,
        resourcekey,
        customizeConfiguration
      );
    };

    /**************************************************************************************************
     * plugin methods
     *************************************************************************************************/
    publish = async (config: PublishConfig, project: IBotProject, metadata, user) => {
      const {
        // these are provided by Composer
        profileName, // the name of the publishing profile "My Azure Prod Slot"

        // these are specific to the azure publish profile shape
        name,
        environment,
        settings,
        accessToken,
      } = config;

      // get the bot id from the project
      const botId = project.id;

      // generate an id to track this deploy
      const jobId = uuid();

      // resource key to map to one provision resource
      const resourcekey = md5([project.name, name, environment].join());

      // Initialize the output logs...
      this.logMessages = ['Publish starting...'];
      // Add first "in process" log message
      const response = {
        status: 202,
        result: {
          id: jobId,
          time: new Date(),
          message: 'Accepted for publishing.',
          log: this.logMessages.join('\n'),
          comment: metadata.comment,
        },
      };
      this.addLoadingStatus(botId, profileName, response);

      try {
        // test creds, if not valid, return 500
        if (!accessToken) {
          throw new Error('Required field `accessToken` is missing from publishing profile.');
        }
        if (!settings) {
          throw new Error('Required field `settings` is missing from publishing profile.');
        }

        this.asyncPublish(config, project, resourcekey, jobId);
      } catch (err) {
        console.log(err);
        if (err instanceof Error) {
          this.logMessages.push(err.message);
        } else if (typeof err === 'object') {
          this.logMessages.push(JSON.stringify(err));
        } else {
          this.logMessages.push(err);
        }

        response.status = 500;
        response.result.message = this.logMessages[this.logMessages.length - 1];

        await this.updateHistory(botId, profileName, { status: response.status, ...response.result });
        this.removeLoadingStatus(botId, profileName, jobId);
        this.cleanup(resourcekey);
      }

      return response;
    };

    getStatus = async (config: PublishConfig, project: IBotProject, user) => {
      const profileName = config.profileName;
      const botId = project.id;
      // return latest status
      const status = this.getLoadingStatus(botId, profileName);
      if (status) {
        return status;
      } else {
        const current = await this.getHistory(botId, profileName);
        if (current.length > 0) {
          return { status: current[0].status, result: { ...current[0] } };
        }
        return {
          status: 404,
          result: {
            message: 'bot not published',
          },
        };
      }
    };

    history = async (config: PublishConfig, project: IBotProject, user) => {
      const profileName = config.profileName;
      const botId = project.id;
      return await this.getHistory(botId, profileName);
    };

    provision = async (config: ProvisionConfig, project: IBotProject, user) => {
      const response = { status: 202 };

      // set in provision status
      this.setProvisionStatus(project.id, config.name, response);
      this.asyncProvision(config, project, user);
      return response;
    };

    getProvisionStatus = async (config: ProvisionConfig, project: IBotProject, user) => {
      // update provision status then return
      if (this.provisionStatus[project.id] && this.provisionStatus[project.id][config.name]) {
        return this.provisionStatus[project.id][config.name];
      } else {
        return {};
      }
    };
  }

  const azurePublish = new AzurePublisher('azurewebapp', 'azurePublish', 'Publish bot to Azure Web App (Preview)');
  const azureFunctionsPublish = new AzurePublisher(
    'azurefunctions',
    'azureFunctionsPublish',
    'Publish bot to Azure Functions (Preview)'
  );

  await composer.addPublishMethod(azurePublish);
  await composer.addPublishMethod(azureFunctionsPublish);
};
