/// <reference path="../base/powerbi/references.d.ts"/>
import {
    NetworkNavigator as NetworkNavigatorImpl,
    INetworkNavigatorData,
    INetworkNavigatorLink,
    INetworkNavigatorNode,
} from "./NetworkNavigator";
import { VisualBase } from "../base/powerbi/VisualBase";
import { Visual, default as Utils, UpdateType } from "../base/powerbi/Utils";
import IVisual = powerbi.IVisual;
import IVisualHostServices = powerbi.IVisualHostServices;
import VisualCapabilities = powerbi.VisualCapabilities;
import VisualInitOptions = powerbi.VisualInitOptions;
import VisualUpdateOptions = powerbi.VisualUpdateOptions;
import IInteractivityService = powerbi.visuals.IInteractivityService;
import InteractivityService = powerbi.visuals.InteractivityService;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import DataView = powerbi.DataView;
import SelectionId = powerbi.visuals.SelectionId;
import utility = powerbi.visuals.utility;
/* tslint:disable */
const colors = require("../base/powerbi/colors");
/* tslint:enable */
declare var _: any;

@Visual(require("./build").output.PowerBI)
export default class NetworkNavigator extends VisualBase implements IVisual {

    /**
     * A list of our data roles
     */
    public static DATA_ROLES = {
        source: {
            displayName: "Source Node",
            name: "SOURCE_NODE",
        },
        target: {
            displayName: "Target Node",
            name: "TARGET_NODE",
        },
        edgeValue: {
            displayName: "Edge Weight",
            name: "EDGE_VALUE",
        }/*,
        sourceGroup: {
            displayName: "Source Node Group",
            name: "SOURCE_GROUP"
        }*/,
        sourceColor: {
            displayName: "Source Node Color",
            name: "SOURCE_NODE_COLOR",
        },
        sourceLabelColor: {
            displayName: "Source Node Label Color",
            name: "SOURCE_LABEL_COLOR",
        }/*,
        targetGroup: {
            displayName: "Target Node Group",
            name: "TARGET_GROUP"
        }*/,
        targetColor: {
            displayName: "Target Node Color",
            name: "TARGET_NODE_COLOR",
        },
        targetLabelColor: {
            displayName: "Target Node Label Color",
            name: "TARGET_LABEL_COLOR",
        },
    };

    public static capabilities: VisualCapabilities = $.extend(true, {}, VisualBase.capabilities, {
        dataRoles: Object.keys(NetworkNavigator.DATA_ROLES).map(n => ({
            name: NetworkNavigator.DATA_ROLES[n].name,
            displayName: NetworkNavigator.DATA_ROLES[n].displayName,
            kind: powerbi.VisualDataRoleKind.GroupingOrMeasure,
        })),
        dataViewMappings: [{
            table: {
                rows: {
                    select: Object.keys(NetworkNavigator.DATA_ROLES).map(n => ({ bind: { to: NetworkNavigator.DATA_ROLES[n].name }}))
                },
            },
            conditions: [Object.keys(NetworkNavigator.DATA_ROLES).reduce((a, b) => {
                a[NetworkNavigator.DATA_ROLES[b].name] = { min: 0, max: 1 };
                return a;
            }, {}), ],
        }, ],
        objects: {
            general: {
                displayName: powerbi.data.createDisplayNameGetter("Visual_General"),
                properties: {
                    filter: {
                        type: { filter: {} },
                        rule: {
                            output: {
                                property: "selected",
                                selector: ["Values"],
                            },
                        },
                    },
                },
            },
            search: {
                displayName: "Search",
                properties: {
                    caseInsensitive: {
                        displayName: "Case Insensitive",
                        type: { bool: true },
                    },
                },
            },
            layout: {
                displayName: "Layout",
                properties: {
                    animate: {
                        displayName: "Animate",
                        description: "Should the graph be animated",
                        type: { bool: true },
                    },
                    maxNodeCount: {
                        displayName: "Max nodes",
                        description: "The maximum number of nodes to render",
                        type: { numeric: true },
                    },
                    linkDistance: {
                        displayName: "Link Distance",
                        type: { numeric: true },
                    },
                    linkStrength: {
                        displayName: "Link Strength",
                        type: { numeric: true },
                    },
                    gravity: {
                        displayName: "Gravity",
                        type: { numeric: true },
                    },
                    charge: {
                        displayName: "Charge",
                        type: { numeric: true },
                    },
                    labels: {
                        displayName: "Labels",
                        description: "If labels on the nodes should be shown",
                        type: { bool: true },
                    },
                    defaultLabelColor: {
                        displayName: "Default Label Color",
                        description: "The default color to use for labels",
                        type: { fill: { solid: { color: true } } },
                    },
                    minZoom: {
                        displayName: "Min Zoom",
                        type: { numeric: true },
                    },
                    maxZoom: {
                        displayName: "Max Zoom",
                        type: { numeric: true },
                    },
                    minEdgeWeightPx: {
                        displayName: "Min Edge Weight(px)",
                        description: "The minimum size of edges in pixels",
                        type: { numeric: true },
                    },
                    maxEdgeWeightPx: {
                        displayName: "Max Edge Weight(px)",
                        description: "The maximum size of edges in pixels",
                        type: { numeric: true },
                    },
                },
            },
        },
    });

    private static DEFAULT_SETTINGS: NetworkNavigatorVisualSettings = {
        search: {
            caseInsensitive: true
        },
        layout: {
            animate: true,
            maxNodeCount: 0,
            linkDistance: 10,
            linkStrength: 2,
            gravity: .1,
            charge: -120,
            labels: false,
            minZoom: .1,
            maxZoom: 100,
            minEdgeWeightPx: .5,
            maxEdgeWeightPx: 5,
            defaultLabelColor: colors[0],
        },
    };

    private myNetworkNavigator: NetworkNavigatorImpl;
    private host: IVisualHostServices;
    private interactivityService: IInteractivityService;
    private listener: { destroy: Function; };

    /**
     * The selection manager
     */
    private selectionManager: utility.SelectionManager;

    private settings: NetworkNavigatorVisualSettings = $.extend(true, {}, NetworkNavigator.DEFAULT_SETTINGS);

    // private template : string = `
    //     <div class="load-container load5">
    //         <div class="loader">Loading...</div>
    //     </div>`;
    private template: string = `
        <div id="node_graph" style= "height: 100%;"> </div>
    `;

    /**
     * Getter for the update type
     */
    private updateType = Utils.updateTypeGetter(this);

    /**
     * Gets called when a node is selected
     */
    private onNodeSelected = _.debounce((node: NetworkNavigatorSelectableNode) => {
        /* tslint:disable */
        let filter: any = null;
        /* tslint:enable */
        if (node) {
            filter = powerbi.data.SemanticFilter.fromSQExpr(node.filterExpr);
            this.selectionManager.select(node.identity, false);
        } else {
            this.selectionManager.clear();
        }

        let objects: powerbi.VisualObjectInstancesToPersist = { };
        if (filter) {
            $.extend(objects, {
                merge: [
                    <VisualObjectInstance>{
                        objectName: "general",
                        selector: undefined,
                        properties: {
                            "filter": filter
                        },
                    },
                ],
            });
        } else {
            $.extend(objects, {
                remove: [
                    <VisualObjectInstance>{
                        objectName: "general",
                        selector: undefined,
                        properties: {
                            "filter": filter
                        },
                    },
                ],
            });
        }

        this.host.persistProperties(objects);
    }, 100);

    /**
     * Converts the data view into an internal data structure
     */
    public static converter(
        dataView: DataView,
        settings: NetworkNavigatorVisualSettings): INetworkNavigatorData<NetworkNavigatorSelectableNode> {
        let nodeList: NetworkNavigatorSelectableNode[] = [];
        let nodeMap: { [name: string] : NetworkNavigatorSelectableNode } = {};
        let linkList: INetworkNavigatorLink[] = [];
        let table = dataView.table;

        let colMap = {};
        dataView.metadata.columns.forEach((c, i) => {
            Object.keys(c.roles).forEach(role => {
                colMap[role] = i;
            });
        });

        // group defines the bundle basically
        // name, user friendly name,
        // num, size of circle, probably meant to be the number of matches
        // source - array index into nodes
        // target - array index into node
        // value - The number of times that the link has been made, ie, I emailed bob@gmail.com 10 times, so value would be 10

        let roles = NetworkNavigator.DATA_ROLES;
        let sourceIdx = colMap[roles.source.name];
        let sourceColorIdx = colMap[roles.sourceColor.name];
        let sourceLabelColorIdx = colMap[roles.sourceLabelColor.name];
        // let sourceGroup = colMap[roles.sourceGroup.name];
        // let targetGroupIdx = colMap[roles.targetGroup.name];
        let targetColorIdx = colMap[roles.targetColor.name];
        let targetLabelColorIdx = colMap[roles.targetLabelColor.name];
        let targetIdx = colMap[roles.target.name];
        const edgeValueIdx = colMap[roles.edgeValue.name];

        let sourceField = dataView.categorical.categories[0].identityFields[sourceIdx];
        let targetField = dataView.categorical.categories[0].identityFields[targetIdx];

        function getNode(
            id: string,
            identity: powerbi.DataViewScopeIdentity,
            isSource: boolean,
            color: string = "gray",
            labelColor: string,
            group: number = 0): NetworkNavigatorSelectableNode {
            const field = (isSource ? sourceField : targetField) as powerbi.data.SQExpr;
            let node = nodeMap[id];
            let expr = powerbi.data.SQExprBuilder.equal(field, powerbi.data.SQExprBuilder.text(id));

            if (!nodeMap[id]) {
                node = nodeMap[id] = {
                    name: id,
                    color: color || "gray",
                    labelColor: labelColor,
                    index: nodeList.length,
                    filterExpr: expr,
                    num: 1,
                    selected: false,
                    identity: SelectionId.createWithId(powerbi.data.createDataViewScopeIdentity(expr)),
                };
                nodeList.push(node);
            }
            return node;
        }

        table.rows.forEach((row, idx) => {
            let identity = table.identity[idx];
            if (row[sourceIdx] && row[targetIdx]) {
                /** These need to be strings to work properly */
                let sourceId = row[sourceIdx] + "";
                let targetId = row[targetIdx] + "";
                let edge = {
                    source:
                        getNode(sourceId, identity, true, row[sourceColorIdx], row[sourceLabelColorIdx]/*, row[sourceGroup]*/).index,
                    target:
                        getNode(targetId, identity, false, row[targetColorIdx], row[targetLabelColorIdx]/*, row[targetGroupIdx]*/).index,
                    value: row[edgeValueIdx] || 0
                };
                nodeList[edge.source].num += 1;
                nodeList[edge.target].num += 1;
                linkList.push(edge);
            }
        });

        const maxNodes = settings.layout.maxNodeCount;
        if (typeof maxNodes === "number" && maxNodes > 0) {
            nodeList = nodeList.slice(0, maxNodes);
            linkList = linkList.filter(n => n.source < maxNodes && n.target < maxNodes);
        }

        return {
            nodes: nodeList,
            links: linkList,
        };
    }

    /** This is called once when the visual is initialially created */
    public init(options: VisualInitOptions): void {
        super.init(options, this.template);
        this.myNetworkNavigator = new NetworkNavigatorImpl(this.element.find("#node_graph"), 500, 500);
        this.host = options.host;
        this.interactivityService = new InteractivityService(this.host);
        this.attachEvents();
        this.selectionManager = new utility.SelectionManager({ hostServices: this.host });
    }

    /** Update is called for data updates, resizes & formatting changes */
    public update(options: VisualUpdateOptions) {
        super.update(options);

        let dataView = options.dataViews && options.dataViews.length && options.dataViews[0];
        let dataViewTable = dataView && dataView.table;
        let forceReloadData = false;

        const type = this.updateType();
        if (type & UpdateType.Settings) {
            forceReloadData = this.updateSettings(options);
        }
        if (type & UpdateType.Resize) {
            this.myNetworkNavigator.dimensions = { width: options.viewport.width, height: options.viewport.height };
            this.element.css({ width: options.viewport.width, height: options.viewport.height });
        }
        if (type & UpdateType.Data || forceReloadData) {
            if (dataViewTable) {
                const newData = NetworkNavigator.converter(dataView, this.settings);
                this.myNetworkNavigator.setData(newData);
            } else {
                this.myNetworkNavigator.setData({
                    links: [],
                    nodes: [],
                });
            }
        }

        const data = this.myNetworkNavigator.getData();
        const nodes = data && data.nodes;
        const selectedIds = this.selectionManager.getSelectionIds();
        if (nodes && nodes.length) {
            let updated = false;
            nodes.forEach((n) => {
                let isSelected =
                    !!_.find(selectedIds, (id: SelectionId) => id.equals((<NetworkNavigatorSelectableNode>n).identity));
                if (isSelected !== n.selected) {
                    n.selected = isSelected;
                    updated = true;
                }
            });

            if (updated) {
                this.myNetworkNavigator.redrawSelection();
            }
        }

        this.myNetworkNavigator.redrawLabels();
    }

    /**
     * Enumerates the instances for the objects that appear in the power bi panel
     */
    public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] {
        let instances = super.enumerateObjectInstances(options) || [{
            /* tslint:disable */
            selector: null,
            /* tslint:enable */
            objectName: options.objectName,
            properties: {},
        }, ];
        $.extend(true, instances[0].properties, this.settings[options.objectName]);
        return instances;
    }

    /**
     * Gets the inline css used for this element
     */
    protected getCss(): string[] {
        return super.getCss().concat([require("!css!sass!./css/NetworkNavigatorVisual.scss")]);
    }

    /**
     * Handles updating of the settings
     */
    private updateSettings(options: VisualUpdateOptions): boolean {
        // There are some changes to the options
        let dataView = options.dataViews && options.dataViews.length && options.dataViews[0];
        if (dataView && dataView.metadata) {
            let oldSettings = $.extend(true, {}, this.settings);
            let newObjects = dataView.metadata.objects;

            // Merge in the settings
            $.extend(true, this.settings, NetworkNavigator.DEFAULT_SETTINGS, newObjects ? newObjects : {}, {
                layout: {
                    defaultLabelColor: newObjects &&
                        newObjects["layout"] &&
                        newObjects["layout"]["defaultLabelColor"] &&
                        newObjects["layout"]["defaultLabelColor"].solid.color,
                },
            });

            // There were some changes to the layout
            if (!_.isEqual(oldSettings, this.settings)) {
                this.myNetworkNavigator.configuration = $.extend(true, {}, this.settings.search, this.settings.layout);
            }

            if (oldSettings.layout.maxNodeCount !== this.settings.layout.maxNodeCount) {
                return true;
            }
        }
        return false;
    }

    /**
     * Returns if all the properties in the first object are present and equal to the ones in the super set
     */
    private objectIsSubset(set: Object, superSet: Object) {
        if (_.isObject(set)) {
            return _.any(_.keys(set), (key: string) => !this.objectIsSubset(set[key], superSet[key]));
        }
        return set === superSet;
    }

    /**
     * Attaches the line up events to lineup
     */
    private attachEvents() {
        if (this.myNetworkNavigator) {
            // Cleans up events
            if (this.listener) {
                this.listener.destroy();
            }
            this.listener =
                this.myNetworkNavigator.events.on("selectionChanged", (node: INetworkNavigatorNode) => this.onNodeSelected(node));
        }
    }
}

/**
 * Represents the settings for this visual
 */
export interface NetworkNavigatorVisualSettings {
    search?: {
        caseInsensitive?: boolean;
    };
    layout?: {
        animate?: boolean;
        maxNodeCount?: number;
        linkDistance?: number;
        linkStrength?: number;
        gravity?: number;
        charge?: number;
        labels?: boolean;
        minZoom?: number;
        maxZoom?: number;
        maxEdgeWeightPx?: number;
        minEdgeWeightPx?: number;
        defaultLabelColor?: string;
    };
};

/**
 * The lineup data
 */
export interface NetworkNavigatorSelectableNode extends powerbi.visuals.SelectableDataPoint, INetworkNavigatorNode {

    /**
     * The nodes index into the node list
     */
    index: number;

    /**
     * Represents the number of edges that this node is connected to
     */
    num: number;

    /**
     * The expression that will exactly match this row
     */
    filterExpr: powerbi.data.SQExpr;
}
