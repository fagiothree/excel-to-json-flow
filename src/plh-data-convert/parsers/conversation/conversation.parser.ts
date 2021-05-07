import { v4 as uuidv4 } from "uuid";
import chalk from "chalk";
//import { FlowTypes, RapidProFlowExport } from "../../../../types";
import { RapidProFlowExport } from "../../../../types";
import { FlowTypes } from "./conversation-flow-type";
import { AbstractParser } from "../abstract.parser";

// Default settings
const version: string = "13";
const site: string = "https://rapidpro.idems.international";
const flowSpecVersion: string = "13.1.0";
const flowLanguage: string = "base";
const flowType: string = "messaging";
const defaultRevision: number = 0;
const flowExpireAfterMinutes: number = 60;

type EntityType = "flow" | "node" | "action" | "router" | "case" | "category" | "exit";

export class ConversationParser implements AbstractParser {
  /** @param deployTarget uuids and media paths may be formatted differently depending on target */
  //constructor(private deployTarget: "app" | "rapidpro" = "app") { }
  constructor(private deployTarget: "app" | "rapidpro" = "rapidpro") { }
  conversationSheet: FlowTypes.ConversationSheet;

  flowEntityIdCounterMap: { [flowName: string]: { [entityType: string]: number } } = {};

  private deterministicUUID(flowName: string, entityType: EntityType) {
    if (!this.flowEntityIdCounterMap[flowName]) {
      this.flowEntityIdCounterMap[flowName] = {};
    }
    if (!this.flowEntityIdCounterMap[flowName].hasOwnProperty(entityType)) {
      this.flowEntityIdCounterMap[flowName][entityType] = 0;
    } else {
      this.flowEntityIdCounterMap[flowName][entityType]++;
    }
    // TODO - counter could probably be replaced by the row_id for nodes
    const counter = this.flowEntityIdCounterMap[flowName][entityType];
    const identifier = "uuid_" + flowName + "_" + entityType + "_" + counter;
    // rapidpro needs strict uuidv4, so only use custom identifiers with the app
    return this.deployTarget === "app" ? identifier : uuidv4();
  }

  public run(conversation: FlowTypes.ConversationSheet): RapidProFlowExport.RootObject {
    this.conversationSheet = conversation;
    const rapidProExportObject: RapidProFlowExport.RootObject = {
      campaigns: [],
      fields: [],
      flows: [],
      groups: [],
      site,
      triggers: [],
      version,
    };
    const rows = conversation.rows;
    try {
      this.setRowIDs(rows);
      // TODO Also need to consider case of updating an existing flow.
      let flow: RapidProFlowExport.Flow = {
        name: conversation.flow_name,
        uuid: this.deterministicUUID(conversation.flow_name, "flow"),
        // TODO This metadata should possibly be passed in from the "Content list" Excel sheet.
        spec_version: flowSpecVersion,
        language: flowLanguage,
        type: flowType,
        nodes: [],
        _ui: null,
        revision: defaultRevision,
        expire_after_minutes: flowExpireAfterMinutes,
        metadata: {
          revision: defaultRevision,
        },
        localization: {},
      };
      const nodesById: { [nodeId: string]: RapidProFlowExport.Node } = {};
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {

        const row = rows[rowIndex];
        console.log("row id: " + row.row_id)
        console.log("row type: " + row.type)

        let nodeId = this.deterministicUUID(conversation.flow_name, "node");
        row.nodeUUIDForExit = nodeId;

        let actionNode: RapidProFlowExport.Node = {
          uuid: nodeId,
          actions: [],
          exits: [this.createEmptyExit()],
        };
        // Additional nodes added for the row e.g. because of a "go_to" type.
        let additionalNodes: RapidProFlowExport.Node[] = [];

        // This takes care of blank rows which may still be included because they have a row_id.
        // TODO Should more checks be done if Type is undefined but there may be other contents?
        if (row.type === undefined) {
          continue;
        } else if (row.type === "send_message" || row.type === "story_slide") {
          if (row.message_text === undefined) {
            throw new Error(
              "On row " +
              row.row_id.toString() +
              ": Message text cannot be blank for Type = send_message."
            );
          }
          let action_text = String(row.message_text);

          // App specific properties that will be appended to message_text in a link.
          let link_text = "https://plh-demo1.idems.international/chat/msg-info?";
          let add_texts: string[] = [];
          let attachmentUrls: string[] = [];

          if (row.character) add_texts.push("character=" + row.character);
          if (row.choose_multi) add_texts.push("chooseMulti=true");
          if (row.display_as_tick) add_texts.push("displayAsTick=true");
          if (row.ticked_by_default + "" === "false") {
            add_texts.push("tickedByDefault=false");
          } else if (row.display_as_tick) {
            add_texts.push("tickedByDefault=true");
          }
          if (row.choice_media_display)
            add_texts.push("choiceMediaDisplay=" + row.choice_media_display);

          let choiceMediaUrls: string[] = [];
          let hasMediaUrls = false;
          for (var i = 1; i < 10; i++) {
            if (row["choice_" + i + "_media"]) {
              hasMediaUrls = true;
            }
            choiceMediaUrls.push(row["choice_" + i + "_media"]);
          }
          if (hasMediaUrls) {
            add_texts.push("choiceMediaUrls=" + encodeURIComponent(JSON.stringify(choiceMediaUrls)));
          }

          let isStory = false;
          if (row.type === "story_slide") {
            add_texts.push("isStory=true");
            isStory = true;
          }

          let imageUrls = this.getImageURLS(row.media);
          let iconUrls = this.getImageURLS(row.icon);

          // Allow use of <icon> or <image>
          // to place media image within message bubble
          /*
          action_text = this.replaceImageTag(action_text, "<image>", "block-image", imageUrls);
          action_text = this.replaceImageTag(action_text, "<icon>", "icon", iconUrls);
          */


          if (isStory) {
            action_text = action_text
              .split("\n")
              .map((line) => "<p>" + line + "</p>")
              .join("\n");
          }
          /////////////end app specific

          if (add_texts.length > 0) action_text += " " + link_text + add_texts.join("&");
          actionNode.actions.push({
            attachments: imageUrls.map((url) => "image:" + url),
            text: action_text,
            type: "send_msg",
            quick_replies: this.getRowChoices(row),
            uuid: this.deterministicUUID(conversation.flow_name, "action"),
          });
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;
          if (row.save_name) {
            let resultNode: RapidProFlowExport.Node = {
              uuid: this.deterministicUUID(conversation.flow_name, "node"),
              actions: [],
              exits: [this.createEmptyExit()],
              router: {
                type: "switch",
                default_category_uuid: null,
                cases: [],
                categories: [
                  {
                    uuid: this.deterministicUUID(conversation.flow_name, "category"),
                    name: "Other",
                    exit_uuid: null,
                  },
                ],
                operand: "@input.text",
                wait: {
                  type: "msg",
                },
                result_name: row.save_name, // Is this ok to be the same as the variable?
              },
            };
            resultNode.router.default_category_uuid = resultNode.router.categories[0].uuid;
            resultNode.router.categories[0].exit_uuid = resultNode.exits[0].uuid;
            additionalNodes.push(resultNode);
            // The initial node exits to the resultNode
            actionNode.exits[0].destination_uuid = resultNode.uuid;
            let saveNode: RapidProFlowExport.Node = {
              uuid: this.deterministicUUID(conversation.flow_name, "node"),
              actions: [
                {
                  uuid: this.deterministicUUID(conversation.flow_name, "action"),
                  type: "set_contact_field",
                  field: {
                    // Can these be the same?
                    key: row.save_name,
                    name: row.save_name,
                  },
                  value: "@results." + row.save_name,
                },
              ],
              exits: [this.createEmptyExit()],
            };
            additionalNodes.push(saveNode);
            // The initial node exits to the resultNode
            resultNode.exits[0].destination_uuid = saveNode.uuid;
            row._rapidProNode = saveNode;
          }
          console.log(row._rapidProNode)
        } else if (row.type === "start_new_flow") {
          actionNode.actions.push({
            flow: {
              name: row.message_text,
              uuid: row.obj_id
            },
            type: "enter_flow",
            uuid: this.deterministicUUID(conversation.flow_name, "action"),
          });
          this.setEnterFlowRouterAndExits(actionNode);
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;

          console.log(row._rapidProNode)
        } else if (row.type === "go_to") {
        } else if (row.type === "add_to_group") {
          actionNode.actions.push({
            groups: [{
              name: row.message_text,
              uuid: row.obj_id
            }],
            type: "add_contact_groups",
            uuid: this.deterministicUUID(conversation.flow_name, "action"),
          });
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;

          console.log(row._rapidProNode)

        } else if (row.type === "remove_from_group") {
          actionNode.actions.push({
            groups: [{
              name: row.message_text,
              uuid: row.obj_id
            }],
            type: "remove_contact_groups",
            all_groups: false,
            uuid: this.deterministicUUID(conversation.flow_name, "action"),
          });
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;

          console.log(row._rapidProNode)

        } else if (row.type === "save_flow_result") {
          actionNode.actions.push({
            type: "set_run_result",
            name: row.save_name,
            value: row.message_text,
            category: "",
            uuid: this.deterministicUUID(conversation.flow_name, "action"),
          });
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;

          console.log(row._rapidProNode)
        } else if (row.type === "set_language") {
          actionNode.actions.push({
            type: "set_contact_language",
            language: row.message_text,
            uuid: this.deterministicUUID(conversation.flow_name, "action"),
          });
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;

          console.log(row._rapidProNode)

        } else if (row.type === "wait_for_response") {
          actionNode = this.createRouterNode("@input", "text", "switch");
          actionNode.router.result_name = row.save_name;
          actionNode.uuid = nodeId;

          if (row.no_response) {
            actionNode.router.wait.timeout.seconds = row.no_response;
            // add no response category and exit
            let emptyExit = this.createEmptyExit();
            let noResponseCategory = {
              exit_uuid: emptyExit.uuid,
              name: "No Response",
              uuid: this.deterministicUUID(this.conversationSheet.flow_name, "category"),
            };
            actionNode.router.categories.push(noResponseCategory)
            actionNode.exits.push(emptyExit)
          }


          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;

          console.log(row._rapidProNode)
        } else if (row.type === "split_by_group") {
          actionNode = this.createRouterNode("@contact", "groups", "switch", "Other");
          actionNode.uuid = nodeId;
          let exit: RapidProFlowExport.Exit =
          {
            uuid: this.deterministicUUID(this.conversationSheet.flow_name, "exit"),
            destination_uuid: null,
          };

          actionNode.exits.push(exit)

          let category: RapidProFlowExport.Category =
          {
            uuid: this.deterministicUUID(this.conversationSheet.flow_name, "category"),
            name: row.message_text,
            exit_uuid: exit.uuid,
          };

          actionNode.router.categories.push(category)

          let rout_case: RapidProFlowExport.RouterCase =
          {
            uuid: this.deterministicUUID(this.conversationSheet.flow_name, "case"),
            type: "has_group",
            arguments: [row.obj_id, row.message_text],
            category_uuid: category.uuid,
          };

          actionNode.router.cases.push(rout_case)

          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;

          console.log(row._rapidProNode)

        } else if (row.type === "split_by_value") {
          // row.message_text contains the operand of the router
          actionNode = this.createRouterNode("", row.message_text, "switch", "Other");
          actionNode.uuid = nodeId;
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;

          console.log(row._rapidProNode)
        } else if (row.type === "save_value") {
          actionNode.actions.push(this.createSaveAction(row.save_name, row.message_text));
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;

          console.log(row._rapidProNode)
        } else if (row.type === "exit") {
          actionNode.actions.push(this.createSaveAction(flow.name + "__completed", "true"));
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;
          if (row.message_text) {
            let enterFlowNode: RapidProFlowExport.Node = {
              uuid: this.deterministicUUID(conversation.flow_name, "node"),
              actions: [
                {
                  flow: {
                    name: row.message_text,
                  },
                  type: "enter_flow",
                  uuid: this.deterministicUUID(conversation.flow_name, "action"),
                },
              ],
              exits: [this.createEmptyExit()],
            };
            // The initial node exits to the newFlowNode
            additionalNodes.push(enterFlowNode);
            actionNode.exits[0].destination_uuid = enterFlowNode.uuid;
            row._rapidProNode = enterFlowNode;
          }
        } else if (row.type === "mark_as_completed") {
          // If message_text is blank mark the flow as complete, otherwise mark the item in message_text as complete.
          let flowOrTask: string
          if (row.message_text) flowOrTask = row.message_text
          else flowOrTask = flow.name
          actionNode.actions.push(this.createSaveAction(flowOrTask + "__completed", "true"));
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;
        } else if (row.type === "split_random") {
          // "split_random" produces a single node. Create this node with empty router.
          // "split_random" should not have a default empty exit.
          actionNode.exits = [];
          actionNode.router = {
            type: "random",
            cases: [],
            categories: []
          }
          row._rapidProNode = actionNode;
          nodesById[nodeId] = actionNode;
        } else {
          continue;
          // throw new Error("Unknown Type");
        }

        // Now add connectivity
        if (row.condition) {
          console.log("row conditions: " + row.condition)
          row.condition = `${row.condition}`;
          //this.processRouterRow(row, rows, flow);
          this.processRouterRowWithMultipleConditions(row, rows, flow);
        } else {
          // If no condition just add as exit to nodes that this row says it comes from.
          // For a "go_to" row set the exit to the NodUUIDForExit of the row mentioned in message_text.
          let fromNodes = this.getFromNodes(row, rows);
          for (let fromNode of fromNodes) {
            if (row.type === "go_to") {
              // TODO This is repeated when there is a condition as well so could move to separate function.
              if (!row.message_text)
                throw new Error(
                  "On row " + row.row_id + ": message_text must contain the row to go to."
                );
              let messageTextRows = rows.filter((r) => (r.row_id = row.message_text));
              if (messageTextRows.length === 1) {
                fromNode.exits[0].destination_uuid = messageTextRows[0].nodeUUIDForExit;
              } else {
                throw new Error(
                  "On row " +
                  row.row_id +
                  ": Cannot find row with row_id = " +
                  row.message_text +
                  " from message_text column."
                );
              }
            } else {
              fromNode.exits[0].destination_uuid = nodeId;
            }
          }
        }
        // Add this after the condition so that the nodes are in a sensible order when importing into Rapid Pro
        // If type is "go_to" then there is no node to add.
        if (row.type !== "go_to") {
          flow.nodes.push(actionNode);
        }
        for (let n of additionalNodes) {
          flow.nodes.push(n);
        }
      }
      rapidProExportObject.flows.push(flow);
      return rapidProExportObject;
    } catch (error) {
      console.log(conversation);
      console.log(chalk.red(error));
      process.exit(1);
    }
  }

  // Create default required router with 2 cases/categories and 2 exit for an "enter_flow" node.
  private setEnterFlowRouterAndExits(node: RapidProFlowExport.Node) {
    let exits: RapidProFlowExport.Exit[] = [
      {
        uuid: this.deterministicUUID(this.conversationSheet.flow_name, "exit"),
        destination_uuid: null,
      },
      {
        uuid: this.deterministicUUID(this.conversationSheet.flow_name, "exit"),
        destination_uuid: null,
      },
    ];
    let categories: RapidProFlowExport.Category[] = [
      {
        uuid: this.deterministicUUID(this.conversationSheet.flow_name, "category"),
        name: "Complete",
        exit_uuid: exits[0].uuid,
      },
      {
        uuid: this.deterministicUUID(this.conversationSheet.flow_name, "category"),
        name: "Expired",
        exit_uuid: exits[1].uuid,
      },
    ];
    let cases: RapidProFlowExport.RouterCase[] = [
      {
        uuid: this.deterministicUUID(this.conversationSheet.flow_name, "case"),
        type: "has_only_text",
        arguments: ["completed"],
        category_uuid: categories[0].uuid,
      },
      {
        uuid: this.deterministicUUID(this.conversationSheet.flow_name, "case"),
        type: "has_only_text",
        arguments: ["expired"],
        category_uuid: categories[1].uuid,
      },
    ];
    // TODO Should this always be overwritting the router and exits or adding to them?
    node.router = {
      cases,
      categories,
      operand: "@child.run.status",
      type: "switch",
      default_category_uuid: categories[0].uuid,
    };
    node.exits = exits;
  }



  private setRowIDs(rows: FlowTypes.ConversationRow[]) {
    let nullRows = rows.filter((row) => row.row_id === undefined);

    if (nullRows.length === rows.length) {
      for (let i = 0; i <= rows.length - 1; i++) {
        rows[i].row_id = (i + 2).toString();
      }
    } else if (nullRows.length === 0) {
      if (new Set(rows.map((row) => row.row_id)).size !== rows.length) {
        throw new Error("row_id values are not unique.");
      }
    } else if (nullRows.length !== rows.length) {
      throw new Error(
        "row_id column has blank values. If row_id is included all rows must have a unique row ID."
      );
    }
  }

  private getFromRowIndices(row: FlowTypes.ConversationRow): string[] {
    if (row.from) {
      return row.from
        .toString()
        .split(";")
        .map((s) => s.trim());
    }
    return [];
  }

  private getFromRows(
    row: FlowTypes.ConversationRow,
    rows: FlowTypes.ConversationRow[]
  ): FlowTypes.ConversationRow[] {
    let ind = this.getFromRowIndices(row);
    console.log("from row index " + ind)
    return rows.filter((curr_row) => ind.includes(curr_row.row_id.toString()));
  }

  private getFromNodes(
    row: FlowTypes.ConversationRow,
    rows: FlowTypes.ConversationRow[]
  ): RapidProFlowExport.Node[] {
    return this.getFromRows(row, rows)
      .map((row) => row._rapidProNode)
      .filter((node) => node !== undefined);
  }

  private getRoutersFromRow(
    currentRow: FlowTypes.ConversationRow,
    rows: FlowTypes.ConversationRow[],
    nodesById: { [nodeId: string]: RapidProFlowExport.Node }
  ): RapidProFlowExport.Node[] {
    const fromNodes = this.getFromNodes(currentRow, rows);

    let fromNodeExits: RapidProFlowExport.Exit[] = [];
    for (let fromNode of fromNodes) {
      for (let exit of fromNode.exits) {
        fromNodeExits.push(exit);
      }
    }
    return fromNodeExits
      .filter((exit) => exit.destination_uuid)
      .map((exit) => nodesById[exit.destination_uuid])
      .filter((node) => node.router);
  }

  private attachToUnattachedCategories(
    routerNode: RapidProFlowExport.Node,
    newExit: RapidProFlowExport.Exit
  ) {
    let routerCategoriesWithoutExits = routerNode.router.cases
      .map((routerCase) => {
        return routerNode.router.categories.find((cat) => cat.uuid === routerCase.category_uuid);
      })
      .filter((category) => !category.exit_uuid);
    routerNode.exits.push(newExit);
    routerCategoriesWithoutExits.forEach((category) => {
      category.exit_uuid = newExit.uuid;
    });
  }

  private createEmptyExit(): RapidProFlowExport.Exit {
    let exit: RapidProFlowExport.Exit = {
      uuid: this.deterministicUUID(this.conversationSheet.flow_name, "exit"),
      destination_uuid: null,
    };
    return exit;
  }

  private createRouterNode(
    operandType: "@input" | "@contact" | "@fields" | "",
    operandValue: "text" | string,
    routerType: "switch" | "random" | string = "switch",
    defaultName: string = "All Responses"
  ): RapidProFlowExport.Node {
    let nodeId = this.deterministicUUID(this.conversationSheet.flow_name, "node");
    let emptyExit = this.createEmptyExit();
    let otherCategory = {
      exit_uuid: emptyExit.uuid,
      name: defaultName,
      uuid: this.deterministicUUID(this.conversationSheet.flow_name, "category"),
    };
    // This is common to "switch" and "random" router nodes.
    let newRouterNode: RapidProFlowExport.Node = {
      uuid: nodeId,
      actions: [],
      router: {
        type: routerType,
        cases: [],
        categories: []
      },
      exits: [],
    };
    if (routerType === "switch") {
      newRouterNode.router.categories = [otherCategory];
      if (operandType == "") {
        newRouterNode.router.operand = operandValue;
      } else {
        newRouterNode.router.operand = operandType + "." + operandValue;
      }

      newRouterNode.router.default_category_uuid = otherCategory.uuid;
      newRouterNode.exits = [emptyExit];
      if (operandType === "@input") {
        newRouterNode.router.wait = {
          type: "msg",
        };
      }
    }
    return newRouterNode;
  }

  // Adds a condition to a router node based on the condition information in a row.
  private addConditionToRouterNode(
    routerNode: RapidProFlowExport.Node,
    row: FlowTypes.ConversationRow,
    rows: FlowTypes.ConversationRow[],
    // TODO This could be more global?
    defaultType: RapidProFlowExport.RouterCaseType = "has_only_phrase"
  ) {
    let type: RapidProFlowExport.RouterCaseType;

    let choiceCategory: RapidProFlowExport.Category;

    // If row has a condition then add a new category, case and exit.
    if (row.condition) {
      row.condition = `${row.condition}`;
      console.log(row.condition)
      console.log(typeof (row.condition))
      let conds: string[];
      if (row.condition.includes(";")) {
        conds = row.condition.split(";").map((s) => s.trim());
      } else conds = [row.condition];

      console.log("conditions " + conds)

      // process every condition

      if (routerNode.actions.length > 0 && routerNode.actions[0].type === "enter_flow") {
        if (conds.length === 2 && conds.includes("completed") && conds.includes("expired")) {
          routerNode.exits[0].destination_uuid = row.nodeUUIDForExit;
          routerNode.exits[1].destination_uuid = row.nodeUUIDForExit;
        } else if (conds.length === 1 && conds.includes("completed")) {
          routerNode.exits[0].destination_uuid = row.nodeUUIDForExit;
        } else if (conds.length === 1 && conds.includes("expired")) {
          routerNode.exits[1].destination_uuid = row.nodeUUIDForExit;
        } else
          throw new Error(
            "Condition for a start_new_flow can only be: completed, expired or both."
          );
        // for split by group only need to set destination uuid
      } else if (routerNode.router.type === "switch" && routerNode.router.cases.length > 0 && routerNode.router.cases[0].type === "has_group") {
        routerNode.exits[1].destination_uuid = row.nodeUUIDForExit;
      } else {
        let exit = this.createEmptyExit();
        if (row.type === "go_to") {
          // TODO This is repeated when there is no condition as well so could move to separate function.
          if (!row.message_text)
            throw new Error(
              "On row " + row.row_id + ": message_text must contain the row to go to."
            );
          let messageTextRows = rows.filter((r) => r.row_id === row.message_text);
          if (messageTextRows.length === 1) {
            exit.destination_uuid = messageTextRows[0].nodeUUIDForExit;
          } else {
            throw new Error(
              "On row " +
              row.row_id +
              ": Cannot find row with row_id = " +
              row.message_text +
              " from message_text column."
            );
          }
        } else {
          exit.destination_uuid = row.nodeUUIDForExit;
        }
        // "random" router should have one category for each item to ensure probabilities are as expected.
        if (routerNode.router.type === "random") {
          for (let con of conds) {
            routerNode.router.categories.push(
              {
                exit_uuid: exit.uuid,
                name: con,
                uuid: this.deterministicUUID(this.conversationSheet.flow_name, "category")
              }
            );
          }
        } else {
          choiceCategory = {
            exit_uuid: exit.uuid,
            name: row.condition,
            uuid: this.deterministicUUID(this.conversationSheet.flow_name, "category")
          };
          routerNode.router.categories.push(choiceCategory);
        }
        routerNode.exits.push(exit);
        // "random" router does not have cases.
        if (routerNode.router.type === "switch") {
          let choiceCases: RapidProFlowExport.RouterCase[] = [];
          // For "has_any_word" arguments is a list of length one with all words separate by spaces.
          if (type === "has_any_word") {
            conds = [conds.join(" ")];
            choiceCases = [
              {
                arguments: conds,
                category_uuid: choiceCategory.uuid,
                type,
                uuid: this.deterministicUUID(this.conversationSheet.flow_name, "case"),
              },
            ];
            // For phrases need one case per phrase linked to the same category. arguments is a list of length one with the phrase.
          } else if (type === "has_only_phrase" || type === "has_phrase") {
            for (let con of conds) {
              choiceCases.push({
                arguments: [con],
                category_uuid: choiceCategory.uuid,
                type,
                uuid: this.deterministicUUID(this.conversationSheet.flow_name, "case"),
              });
            }
          } else {
            // TODO Other types needs to be implemented. This is not correct for all other types.
            conds = [conds.join(" ")];
            choiceCases = [
              {
                arguments: conds,
                category_uuid: choiceCategory.uuid,
                type,
                uuid: this.deterministicUUID(this.conversationSheet.flow_name, "case"),
              },
            ];
          }
          for (let c of choiceCases) {
            routerNode.router.cases.push(c);
          }
        }
      }
    } else {
      if (routerNode.router.type === "random") {
        throw new Error(
          "Cannot have no row_condition for random type."
        );
      }
      // If the row has no condition then update the default (other) exit.
      // Routers are always created with a default (empty) exit so this always exists.
      routerNode.exits[0].destination_uuid = row.nodeUUIDForExit;
    }
  }



  private addSingleConditionToRouterNode(
    routerNode: RapidProFlowExport.Node,
    row: FlowTypes.ConversationRow,
    rows: FlowTypes.ConversationRow[],
    cond: string,
    cond_type: string,
    cat_name: string
  ) {
    // add a new category, case and exit for the condition.
    if (cond != "") {
      let choiceCategory: RapidProFlowExport.Category;
      if (routerNode.actions.length > 0 && routerNode.actions[0].type === "enter_flow") {
        if (cond == "completed") {
          routerNode.exits[0].destination_uuid = row.nodeUUIDForExit;
        } else if (cond == "expired") {
          routerNode.exits[1].destination_uuid = row.nodeUUIDForExit;
        } else
          throw new Error(
            "Condition for a start_new_flow can only be: completed or expired"
          );

        // for split by group only need to set destination uuid
      } else if (routerNode.router.type === "switch" && routerNode.router.cases.length > 0 && routerNode.router.cases[0].type === "has_group") {
        routerNode.exits[1].destination_uuid = row.nodeUUIDForExit;

        // wait for response needs to be processed separately because of the "No response" exit which doesn't correspond to a case
      } else if (routerNode.router.operand == "@input.text" && routerNode.router.hasOwnProperty("wait") && cond == "No Response") {

        if (!routerNode.router.wait.timeout)
          throw new Error(
            "On row " + row.row_id + ": no response condition without timeout"
          );
        let no_resp_cat = routerNode.router.categories.filter(cat => (cat.name == "No Response"))[0];
        let no_cat_exit = no_resp_cat.exit_uuid;
        routerNode.exits.filter(ex => (ex.uuid) == no_cat_exit)[0].destination_uuid = row.nodeUUIDForExit;


      } else {
        let exit = this.createEmptyExit();
        if (row.type === "go_to") {
          // TODO This is repeated when there is no condition as well so could move to separate function.
          if (!row.message_text)
            throw new Error(
              "On row " + row.row_id + ": message_text must contain the row to go to."
            );
          let messageTextRows = rows.filter((r) => r.row_id === row.message_text);
          if (messageTextRows.length === 1) {
            exit.destination_uuid = messageTextRows[0].nodeUUIDForExit;
          } else {
            throw new Error(
              "On row " +
              row.row_id +
              ": Cannot find row with row_id = " +
              row.message_text +
              " from message_text column."
            );
          }
        } else {
          exit.destination_uuid = row.nodeUUIDForExit;
        }

        routerNode.exits.push(exit);

        
        // create category
        if (cat_name != "") {
          let all_cat_names = this.getAllCategoryNames(routerNode);
          // if cat_name is already a name of a category, define choiceCategory as that category
          // ==> if a category name is used multiple times, it is assumed that multiple cases correspond to the same category
          if (all_cat_names.includes(cat_name)){
            choiceCategory = routerNode.router.categories.filter(cat =>(cat.name == cat_name))[0];
          } else {
            choiceCategory =
            {
              exit_uuid: exit.uuid,
              name: cat_name,
              uuid: this.deterministicUUID(this.conversationSheet.flow_name, "category"),
            }
            routerNode.router.categories.push(choiceCategory);
  
          }

         // if the name of category is an empty string, it needs to be genated from cond so that it is unique (can't have 2 cat with the same name and different uuids)
        } else {
          choiceCategory =
          {
            exit_uuid: exit.uuid,
            name: this.generateCategoryName(routerNode, cond),
            uuid: this.deterministicUUID(this.conversationSheet.flow_name, "category"),
          }
          routerNode.router.categories.push(choiceCategory);

        }



        // create corresponding case
        // "random" router does not have cases.
        if (routerNode.router.type === "switch") {
          let choiceCase: RapidProFlowExport.RouterCase;
          if (cond_type == "has_number_between") {
            if (cond.includes(",")) {
              let conds_betw = cond.split(",").map((s) => s.trim());
              choiceCase =
              {
                arguments: conds_betw,
                category_uuid: choiceCategory.uuid,
                type: cond_type,
                uuid: this.deterministicUUID(this.conversationSheet.flow_name, "case"),
              };

            } else {
              throw new Error(
                "On row " + row.row_id + ": condition for number between must contain 2 numbers separated by a comma"
              );

            }

          } else {
            if (cond_type == "") {
              throw new Error(
                "On row " + row.row_id + ": empty cond type"
              );
            } else {
              if (cond_type == "has_any_word"
                || cond_type == "has_all_words"
                || cond_type == "has_only_phrase"
                || cond_type == "has_phrase"
                || cond_type == "has_number_between"
                || cond_type == "has_number_lt"
                || cond_type == "has_number_lte"
                || cond_type == "has_number_gt"
                || cond_type == "has_number_gte"
                || cond_type == "has_number_eq"
                || cond_type == "has_only_text"
                || cond_type == "has_group"
                || cond_type == "has_pattern") {
                choiceCase =
                {
                  arguments: [cond],
                  category_uuid: choiceCategory.uuid,
                  type: cond_type,
                  uuid: this.deterministicUUID(this.conversationSheet.flow_name, "case"),
                };

              } else {
                throw new Error(
                  "On row " + row.row_id + ": condition type not recognised"
                );


              }


            }



          }

          routerNode.router.cases.push(choiceCase);

        }



      }
    } else {
      if (routerNode.router.type === "random") {
        throw new Error(
          "Cannot have no row_condition for random type."
        );
      }
      // If the row has no condition then update the default (other) exit.
      // Routers are always created with a default (empty) exit so this always exists.
      routerNode.exits[0].destination_uuid = row.nodeUUIDForExit;
    }



  }




  private processRouterRow(
    row: FlowTypes.ConversationRow,
    rows: FlowTypes.ConversationRow[],
    flow: RapidProFlowExport.Flow
  ) {
    let fromNodes = this.getFromNodes(row, rows);
    let fromRows = this.getFromRows(row, rows);
    let routerNode: RapidProFlowExport.Node;
    let newRouterNode: RapidProFlowExport.Node;
    let first: boolean = true;
    let operandType: "@input" | "@fields" | "" = "";
    let operandValue: "text" | string = "";


    // If condition_var is given this is operandValue
    if (row.condition_var && row.condition_var.length > 0) {
      const regex = /(@[a-z]+)\.([\S]*)/;
      const matches = row.condition_var.match(regex);
      if (matches) {
        operandType = matches[1] as any;
        operandValue = matches[2];
        console.log(operandType)
        console.log(operandValue)
      } else {
        operandType = "@fields";
        operandValue = row.condition_var;
      }
      console.log(operandType + "." + operandValue)
      // If the first fromRow has a save_name then the condition is from a saved field.
    } else if (fromRows && fromRows.length > 0 && fromRows[0].type != "wait_for_response" && fromRows[0].save_name) {
      operandType = "@fields";
      operandValue = fromRows[0].save_name;
    } else if (fromRows && fromRows.length > 0 && fromRows[0].type === "split_random") {
      operandType = "";
      operandValue = "";
      // If there is no condition_var and fromNode is not of type "set_contact_field" and fromRow is not "split_random" then assumed to be input from text.
    } else {
      operandType = "@input";
      operandValue = "text";
    }
    // Each "from row/node" needs to have its exits updated with a router (could be new or existing router)
    for (let i = 0; i <= fromNodes.length - 1; i++) {
      let fromNode = fromNodes[i];
      let fromRow = fromRows[i];


      let routerType: string;
      if (fromRow.type === "split_random") {
        routerType = "random";
      } else {
        routerType = "switch";
      }
      console.log(routerType)
      console.log(fromNode.router)
      // If fromNode is a router of the same type as the current node/row then add a condition to fromNode for the current row/node.
      console.log(fromNode.router.operand == operandType + "." + operandValue)
      if (
        fromNode.router &&
        fromNode.router.type === routerType &&
        ((fromNode.router.type === "switch" &&
          fromNode.router.operand &&
          fromNode.router.operand == operandType + "." + operandValue) ||
          fromNode.router.type === "random")
      ) {
        console.log("from node router type:" + fromNode.router.type)
        this.addConditionToRouterNode(fromNode, row, rows);
      } else {
        // If fromNode is not a router or router of a different type then create a new router
        // of the same type and add a condition for the current row/node.
        // Only one new router is created for all fromNodes so that all fromNodes go to the same router.
        // There may be cases where multiple routers may be desired, but this can be done by
        // ordering the rows of the Excel sheet to have different router cases first.
        // TODO Create an example Excel file to demonstate this.
        if (first) {
          newRouterNode = this.createRouterNode(operandType, operandValue, routerType);
          this.addConditionToRouterNode(newRouterNode, row, rows);
          flow.nodes.push(newRouterNode);
          first = false;
        }
        routerNode = newRouterNode;
        // If fromNode is a router of a different type then in parent If then set the "other" exit to the new router
        // If fromNode is not a router and has exactly 1 exit then the fromNode now goes to the new router
        // and the existing exit of fromNode is now the "other" of the router
        // If fromNode has multiple exits but is not a router than this is not valid.
        if (fromNode.router) {
          if (fromNode.exits[0].destination_uuid) {
            // How should we throw errors?
            // Should give details of both exits.
            throw new Error("Attempting to set multiple default exits");
          }
          fromNode.exits[0].destination_uuid = routerNode.uuid;
        } else if (fromNode.exits.length == 1) {
          // Takes
          let oldExitDestUuid = fromNode.exits[0].destination_uuid;
          fromNode.exits[0].destination_uuid = routerNode.uuid;
          routerNode.exits[0].destination_uuid = oldExitDestUuid;
        } else {
          // How should we throw errors?
          throw new Error("Multiple exists defined but node is not a router");
        }
        // Update the rows which currently link to fromNode to now link to routerNode.
        // This ensures that the next time these rows are updated the are correctly linked to routerNode.
        let fromRows = rows.filter((row) => row._rapidProNode == fromNode);
        // This may or may not be a concern if fromNode is not linked to exactly 1 row.
        if (fromRows.length !== 1)
          throw new console.warn("A node is attached to " + fromRows.length.toString() + " rows.");
        for (let fromRow of fromRows) {
          fromRow._rapidProNode = routerNode;
        }
      }
    }
  }


  private processRouterRowWithMultipleConditions(
    row: FlowTypes.ConversationRow,
    rows: FlowTypes.ConversationRow[],
    flow: RapidProFlowExport.Flow
  ) {
    let fromNodes = this.getFromNodes(row, rows);
    let fromRows = this.getFromRows(row, rows);
    let routerNode: RapidProFlowExport.Node;
    let newRouterNode: RapidProFlowExport.Node;
    let first: boolean = true;
    let operandType: "@input" | "@fields" | "" = "";
    let operandValue: "text" | string = "";


    if (row.condition) {
      var conds: string[];
      if (row.condition.includes(";")) {
        conds = row.condition.split(";").map((s) => s.trim());
      } else {
        conds = [row.condition];
      }

      if (conds.length != fromRows.length) {
        throw new Error(
          "On row " +
          row.row_id.toString() +
          ": # of conditions different from # of fromrows"
        );
      }


      var cond_types: string[];

      if (row.condition_type) {
        if (row.condition_type.includes(";")) {
          cond_types = row.condition_type.split(";").map((s) => s.trim());
        } else {
          cond_types = [row.condition_type];
        }
      } else {
        cond_types = [];
        conds.forEach(c => { cond_types.push("") })
      }
      if (cond_types.length != conds.length) {
        throw new Error(
          "On row " +
          row.row_id.toString() +
          ": # of cond types different from # conditions"
        );
      }

      var cond_vars: string[];

      if (row.condition_var) {
        if (row.condition_var.includes(";")) {
          cond_vars = row.condition_var.split(";").map((s) => s.trim());
        } else {
          cond_vars = [row.condition_var];
        }
      } else {
        cond_vars = [];
        conds.forEach(c => { cond_vars.push("") })
      }

      if (cond_vars.length != conds.length) {
        throw new Error(
          "On row " +
          row.row_id.toString() +
          ": # of cond variables different from # conditions"
        );
      }


      var cond_names: string[];
      if (row.condition_name) {
        if (row.condition_name.includes(";")) {
          cond_names = row.condition_name.split(";").map((s) => s.trim());
        } else {
          cond_names = [row.condition_name];
        }
      } else {
        cond_names = [];
        conds.forEach(c => { cond_names.push("") })
      }

      if (cond_names.length != conds.length) {
        throw new Error(
          "On row " +
          row.row_id.toString() +
          ": # of cond names different from # conditions"
        );
      }

    } else {
      // if row.condition is empty cond_type and cond_var need to be empty as well
      if (row.condition_type) {
        throw new Error(
          "On row " +
          row.row_id.toString() +
          ": condition is empty but cond_type is not"
        );
      }
      if (row.condition_var) {
        throw new Error(
          "On row " +
          row.row_id.toString() +
          ": condition is empty but cond_var is not"
        );
      }

      if (row.condition_name) {
        throw new Error(
          "On row " +
          row.row_id.toString() +
          ": condition is empty but cond_name is not"
        );
      }

      // create arrays of empty strings (one per fromrow)
      var conds: string[];
      var cond_types: string[];
      var cond_vars: string[];
      var cond_names: string[];
      conds = [];
      cond_types = [];
      cond_vars = [];
      cond_names = [];

      fromRows.forEach(r => {
        conds.push("");
        cond_types.push("");
        cond_vars.push("");
        cond_names.push("");
      });

    }
    console.log("conditions: " + conds)
    console.log("condition types: " + cond_types)
    console.log("condition variables: " + cond_vars)
    console.log("condition names: " + cond_names)

    // Each "from row/node" needs to have its exits updated with a router (could be new or existing router)
    for (let i = 0; i <= fromNodes.length - 1; i++) {
      let fromNode = fromNodes[i];
      let fromRow = fromRows[i];
      console.log("from row: " + fromRow.row_id)
      let curr_cond = conds[i];
      let curr_type = cond_types[i];
      let curr_cat_name = cond_names[i];

      let curr_var = cond_vars[i];

      // If condition_var is given this is operandValue
      if (curr_var != "") {
        console.log("curr_var not empty string")
        const regex = /(@[a-z]+)\.([\S]*)/;
        const matches = curr_var.match(regex);
        if (matches) {
          operandType = matches[1] as any;
          operandValue = matches[2];
        } else {
          operandType = "@fields";
          operandValue = curr_var;
        }

        // If the first fromRow has a save_name then the condition is from a saved field.
      } else if (fromRow.save_name && fromRow.type != "wait_for_response") {
        operandType = "@fields";
        operandValue = fromRow.save_name;
      } else if (fromRow.type === "split_random") {
        operandType = "";
        operandValue = "";
        // If there is no condition_var and fromNode is not of type "set_contact_field" and fromRow is not "split_random" then assumed to be input from text.
      } else {
        operandType = "@input";
        operandValue = "text";
      }

      console.log("operand " + operandType + "." + operandValue)

      let routerType: string;
      if (fromRow.type === "split_random") {
        routerType = "random";
      } else {
        routerType = "switch";
      }

      // If fromNode is a router of the same type as the current node/row then add a condition to fromNode for the current row/node.
      if (
        fromNode.router &&
        fromNode.router.type === routerType &&
        ((fromNode.router.type === "switch" &&
          fromNode.router.operand &&
          fromNode.router.operand == operandType + "." + operandValue) ||
          fromNode.router.type === "random")
      ) {

        this.addSingleConditionToRouterNode(fromNode, row, rows, curr_cond, curr_type, curr_cat_name);


      } else {
        // If fromNode is not a router or router of a different type then create a new router
        // of the same type and add a condition for the current row/node.
        // Only one new router is created for all fromNodes so that all fromNodes go to the same router.
        // There may be cases where multiple routers may be desired, but this can be done by
        // ordering the rows of the Excel sheet to have different router cases first.
        // TODO Create an example Excel file to demonstate this.
        if (first) {
          newRouterNode = this.createRouterNode(operandType, operandValue, routerType);
          this.addSingleConditionToRouterNode(newRouterNode, row, rows, curr_cond, curr_type, curr_cat_name);
          flow.nodes.push(newRouterNode);
          first = false;
        }
        routerNode = newRouterNode;

        // If fromNode is a router of a different type then in parent If then set the "other" exit to the new router
        // If fromNode is not a router and has exactly 1 exit then the fromNode now goes to the new router
        // and the existing exit of fromNode is now the "other" of the router
        // If fromNode has multiple exits but is not a router than this is not valid.
        if (fromNode.router) {
          if (fromNode.exits[0].destination_uuid) {
            // How should we throw errors?
            // Should give details of both exits.
            throw new Error("Attempting to set multiple default exits");
          }
          fromNode.exits[0].destination_uuid = routerNode.uuid;
        } else if (fromNode.exits.length == 1) {
          // Takes
          let oldExitDestUuid = fromNode.exits[0].destination_uuid;
          fromNode.exits[0].destination_uuid = routerNode.uuid;
          routerNode.exits[0].destination_uuid = oldExitDestUuid;
        } else {
          // How should we throw errors?
          throw new Error("Multiple exists defined but node is not a router");
        }
        // Update the rows which currently link to fromNode to now link to routerNode.
        // This ensures that the next time these rows are updated the are correctly linked to routerNode.
        let fromRows = rows.filter((row) => row._rapidProNode == fromNode);
        // This may or may not be a concern if fromNode is not linked to exactly 1 row.
        if (fromRows.length !== 1)
          throw new console.warn("A node is attached to " + fromRows.length.toString() + " rows.");
        for (let fromRow of fromRows) {
          fromRow._rapidProNode = routerNode;
        }

      }
    }
  }

  private getRowChoices(row: FlowTypes.ConversationRow): string[] {
    let quick_replies: string[] = [];
    for (let i = 1; i <= 12; i++) {
      if (row["choice_" + i] !== undefined) {
        let reply = row["choice_" + i].toString();
        if (row["choice_" + i + "_Media"] !== undefined) {
          reply += " " + row["choice_" + i + "_Media"].toString();
        }
        quick_replies.push(reply);
      }
    }
    return quick_replies;
  }



  private getImageURLS(mediaText: string): string[] {
    const list = [];
    if (mediaText === undefined || mediaText === "") return [];
    mediaText.split("\n").forEach((line) => {
      line.split(";").forEach((s) => {
        list.push(s.trim());
      });
    });
    return list;
  }

  private createSaveAction(fieldKey: string, value: string): RapidProFlowExport.Action {
    const stringValue = "" + value;
    return {
      uuid: this.deterministicUUID(this.conversationSheet.flow_name, "action"),
      type: "set_contact_field",
      field: {
        // Can these be the same?
        key: fieldKey,
        name: fieldKey,
      },
      value: stringValue
    };
  }

  private replaceImageTag(text: string, imageTag: string, className: string, urls: string[]): string {
    const regex = new RegExp(imageTag, "g");
    return text.replace(regex, () => {
      if (urls.length > 0) {
        const imageUrl = "assets/plh_assets/" + urls.pop();
        return `<img class="${className}" src="${imageUrl}">`;
      }
      return "";
    });
  }




  private getAllCategoryNames(routerNode: RapidProFlowExport.Node): string[] {
    let cat_names = [];
    routerNode.router.categories.forEach(cat => {cat_names.push(cat.name)})
    return cat_names
  }

  private generateCategoryName(routerNode: RapidProFlowExport.Node, cond: string): string {
    let case_cat_name: string;
    let new_cat_name: string;

    let cat_names_list = this.getAllCategoryNames(routerNode);

    if (!cat_names_list.includes(cond)){
      case_cat_name = cond;
    } else {
      new_cat_name = cond + "_new"
      case_cat_name = this.generateCategoryName(routerNode,new_cat_name)
    }

    return case_cat_name
    
  }











}



