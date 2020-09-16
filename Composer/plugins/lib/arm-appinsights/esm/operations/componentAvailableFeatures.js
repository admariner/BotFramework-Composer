/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for
 * license information.
 *
 * Code generated by Microsoft (R) AutoRest Code Generator.
 * Changes may cause incorrect behavior and will be lost if the code is
 * regenerated.
 */
import * as msRest from '@azure/ms-rest-js';
import * as Mappers from '../models/componentAvailableFeaturesMappers';
import * as Parameters from '../models/parameters';
/** Class representing a ComponentAvailableFeatures. */
var ComponentAvailableFeatures = /** @class */ (function () {
    /**
     * Create a ComponentAvailableFeatures.
     * @param {ApplicationInsightsManagementClientContext} client Reference to the service client.
     */
    function ComponentAvailableFeatures(client) {
        this.client = client;
    }
    ComponentAvailableFeatures.prototype.get = function (resourceGroupName, resourceName, options, callback) {
        return this.client.sendOperationRequest({
            resourceGroupName: resourceGroupName,
            resourceName: resourceName,
            options: options,
        }, getOperationSpec, callback);
    };
    return ComponentAvailableFeatures;
}());
export { ComponentAvailableFeatures };
// Operation Specifications
var serializer = new msRest.Serializer(Mappers);
var getOperationSpec = {
    httpMethod: 'GET',
    path: 'subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.Insights/components/{resourceName}/getavailablebillingfeatures',
    urlParameters: [Parameters.resourceGroupName, Parameters.subscriptionId, Parameters.resourceName],
    queryParameters: [Parameters.apiVersion],
    headerParameters: [Parameters.acceptLanguage],
    responses: {
        200: {
            bodyMapper: Mappers.ApplicationInsightsComponentAvailableFeatures,
        },
        default: {
            bodyMapper: Mappers.CloudError,
        },
    },
    serializer: serializer,
};
//# sourceMappingURL=componentAvailableFeatures.js.map