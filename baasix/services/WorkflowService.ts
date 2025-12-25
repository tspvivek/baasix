import { createRequire } from 'module';
import { db } from "../utils/db.js";
import { getCache } from "../utils/cache.js";
import ItemsService from "./ItemsService.js";
import { hooksManager } from "./HooksManager.js";
import socketService from "./SocketService.js";
import mailService from "./MailService.js";
import statsService from "./StatsService.js";
import schedule from "node-schedule";
import { eq } from "drizzle-orm";
import { schemaManager } from "../utils/schemaManager.js";

/**
 * WorkflowService - Comprehensive workflow execution engine
 * Supports: HTTP requests, data transformation, conditions, loops, service operations
 */
class WorkflowService {
    private initialized: boolean = false;
    private scheduledJobs: Map<string | number, schedule.Job> = new Map();
    private customModules: Map<string, any> = new Map(); // Registry for custom modules
    private stepProcessors: Record<string, Function>;

    constructor() {
        this.stepProcessors = {
            trigger: this.processTriggerNode.bind(this),
            http: this.processHttpNode.bind(this),
            transform: this.processTransformNode.bind(this),
            condition: this.processConditionNode.bind(this),
            service: this.processServiceNode.bind(this),
            loop: this.processLoopNode.bind(this),
            filter: this.processFilterNode.bind(this),
            aggregate: this.processAggregateNode.bind(this),
            delay: this.processDelayNode.bind(this),
            notification: this.processNotificationNode.bind(this),
            email: this.processEmailNode.bind(this),
            workflow: this.processWorkflowNode.bind(this),
            stats: this.processStatsNode.bind(this),
            file: this.processFileNode.bind(this),
            variable: this.processVariableNode.bind(this),
            script: this.processScriptNode.bind(this),
            try: this.processTryNode.bind(this),
        };
    }

    /**
     * Register a custom module that can be used in script nodes
     * @param moduleName - Name of the module (used in require())
     * @param moduleExport - The module export (function, object, or class)
     * @param options - Optional configuration
     */
    registerCustomModule(moduleName: string, moduleExport: any, options: any = {}) {
        if (!moduleName || typeof moduleName !== "string") {
            throw new Error("Module name must be a non-empty string");
        }

        if (!moduleExport) {
            throw new Error("Module export is required");
        }

        this.customModules.set(moduleName, {
            name: moduleName,
            export: moduleExport,
            description: options.description || "",
            allowRequire: options.allowRequire !== false, // Default to true
            registeredAt: new Date(),
        });

        console.info(`WorkflowService: Registered custom module "${moduleName}"`);
    }

    /**
     * Unregister a custom module
     * @param moduleName - Name of the module to unregister
     */
    unregisterCustomModule(moduleName: string): boolean {
        if (this.customModules.has(moduleName)) {
            this.customModules.delete(moduleName);
            console.info(`WorkflowService: Unregistered custom module "${moduleName}"`);
            return true;
        }
        return false;
    }

    /**
     * Get all registered custom modules
     * @returns List of registered modules with metadata
     */
    getRegisteredModules() {
        return Array.from(this.customModules.values()).map((module) => ({
            name: module.name,
            description: module.description,
            allowRequire: module.allowRequire,
            registeredAt: module.registeredAt,
        }));
    }

    /**
     * Check if a module is available (built-in or custom)
     * @param moduleName - Name of the module
     * @returns boolean
     */
    isModuleAvailable(moduleName: string): boolean {
        // Check built-in modules
        const builtInModules = [
            "lodash",
            "_",
            "dayjs",
            "axios",
            "crypto",
            "uuid",
            "joi",
            "validator",
            "bcrypt",
            "jsonwebtoken",
        ];

        if (builtInModules.includes(moduleName)) {
            return true;
        }

        // Check custom modules
        return this.customModules.has(moduleName);
    }

    async init() {
        if (this.initialized) {
            return;
        }

        try {
            // Register hooks for workflow triggers
            this.registerWorkflowHooks();

            // Initialize scheduled workflows
            await this.initializeScheduledWorkflows();

            this.initialized = true;
            console.info("WorkflowService initialized successfully");
        } catch (error: any) {
            console.warn("WorkflowService: Initialization failed:", error.message);
        }
    }

    async ensureInitialized() {
        if (!this.initialized) {
            await this.init();
        }
    }

    /**
     * Create execution record (without starting execution)
     */
    async createExecutionRecord(workflowId: string | number, userId: any = null, tenantId: any = null) {
        await this.ensureInitialized();

        const workflowService = new ItemsService("baasix_Workflow");
        const executionService = new ItemsService("baasix_WorkflowExecution");

        // Fetch workflow
        const workflowResult = await workflowService.readOne(workflowId);
        if (!workflowResult) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        if (workflowResult.status !== "active") {
            throw new Error(`Workflow ${workflowId} is not active`);
        }

        // Create execution record
        const executionId = await executionService.createOne({
            workflow_Id: workflowId,
            status: "queued",
            trigger_data: {},
            context_data: {
                variables: { ...workflowResult.variables },
                trigger: {},
            },
            tenant_Id: tenantId || workflowResult.tenant_Id,
            triggered_by_Id: userId,
        });

        // Read the full execution record to return
        const execution = await executionService.readOne(executionId);

        // Ensure execution record has 'id' property (primary key might have different name)
        execution.id = executionId;

        return execution;
    }

    /**
     * Execute workflow asynchronously using existing execution record
     */
    async executeWorkflowAsync(
        workflowId: string | number,
        triggerData: any = {},
        userId: any = null,
        tenantId: any = null,
        executionId: any = null
    ) {
        await this.ensureInitialized();

        const workflowService = new ItemsService("baasix_Workflow");

        try {
            // Fetch workflow
            const workflow = await workflowService.readOne(workflowId);
            if (!workflow) {
                throw new Error(`Workflow ${workflowId} not found`);
            }

            // Update trigger data in execution record
            if (executionId) {
                const executionService = new ItemsService("baasix_WorkflowExecution");
                await executionService.updateOne(executionId, { trigger_data: triggerData });
            }

            // Execute asynchronously
            await this.runWorkflowExecution(executionId, workflow, triggerData);
        } catch (error) {
            console.error("Error executing workflow:", error);
            throw error;
        }
    }

    /**
     * Execute a workflow (legacy method - creates record and executes)
     */
    async executeWorkflow(
        workflowId: string | number,
        triggerData: any = {},
        userId: any = null,
        tenantId: any = null
    ) {
        await this.ensureInitialized();

        const workflowService = new ItemsService("baasix_Workflow");
        const executionService = new ItemsService("baasix_WorkflowExecution");

        try {
            // Fetch workflow
            const workflow = await workflowService.readOne(workflowId);
            if (!workflow) {
                throw new Error(`Workflow ${workflowId} not found`);
            }

            if (workflow.status !== "active") {
                throw new Error(`Workflow ${workflowId} is not active`);
            }

            // Create execution record
            const executionId = await executionService.createOne({
                workflow_Id: workflowId,
                status: "queued",
                trigger_data: triggerData,
                context_data: {
                    variables: { ...workflow.variables },
                    trigger: triggerData,
                },
                tenant_Id: tenantId || workflow.tenant_Id,
                triggered_by_Id: userId,
            });

            // Read the full execution record to return
            const execution = await executionService.readOne(executionId);

            // Ensure execution record has 'id' property (primary key might have different name)
            execution.id = executionId;

            // Execute asynchronously
            this.runWorkflowExecution(executionId, workflow, triggerData).catch((error) => {
                console.error(`Workflow execution ${executionId} failed:`, error);
            });

            return execution;
        } catch (error) {
            console.error("Error executing workflow:", error);
            throw error;
        }
    }

    /**
     * Run workflow execution
     */
    async runWorkflowExecution(executionId: string | number, workflow: any, triggerData: any) {
        const executionService = new ItemsService("baasix_WorkflowExecution");
        const logService = new ItemsService("baasix_WorkflowExecutionLog");

        const startTime = Date.now();

        try {
            // Update execution status
            await executionService.updateOne(executionId, {
                status: "running",
                startedAt: new Date(),
            });

            // Emit execution started event
            socketService.emitWorkflowExecutionUpdate(executionId, {
                status: "running",
            });

            const { nodes, edges } = workflow.flow_data;

            // Initialize context with workflow variables and trigger data
            const context: any = {
                variables: { ...workflow.variables },
                trigger: triggerData,
                outputs: {}, // Store outputs from each node
            };

            // Find start node (trigger node)
            const startNode = nodes.find((n: any) => n.type === "trigger");
            if (!startNode) {
                throw new Error("No trigger node found in workflow");
            }

            // Execute workflow graph
            await this.executeNode(startNode, nodes, edges, context, executionId, logService);

            // Mark execution as completed
            const duration = Date.now() - startTime;
            await executionService.updateOne(executionId, {
                status: "completed",
                completedAt: new Date(),
                durationMs: duration,
                result_data: context.outputs,
            });

            // Emit execution completed event
            socketService.emitWorkflowExecutionComplete(executionId, {
                status: "completed",
                duration,
            });

            console.info(`Workflow execution ${executionId} completed in ${duration}ms`);
        } catch (error: any) {
            const duration = Date.now() - startTime;
            await executionService.updateOne(executionId, {
                status: "failed",
                completedAt: new Date(),
                durationMs: duration,
                errorMessage: error.message,
            });

            // Emit execution failed event
            socketService.emitWorkflowExecutionComplete(executionId, {
                status: "failed",
                error: error.message,
            });

            console.error(`Workflow execution ${executionId} failed:`, error);
            throw error;
        }
    }

    /**
     * Execute a single node and its descendants
     */
    async executeNode(node: any, allNodes: any[], edges: any[], context: any, executionId: string | number, LogService: ItemsService) {
        const nodeStartTime = Date.now();
        let logId: string | number | undefined;

        try {
            // Emit node started event
            socketService.emitWorkflowExecutionUpdate(executionId, {
                currentNodeId: node.id,
                nodeId: node.id,
                nodeStatus: "running",
                inputData: {
                    trigger: context.trigger,
                    variables: context.variables,
                    loop: context.loop,
                    error: context.error,
                },
            });

            // Create log entry
            logId = await LogService.createOne({
                execution_Id: executionId,
                nodeId: node.id,
                nodeType: node.type,
                nodeLabel: node.data?.label || node.type,
                status: "running",
                inputData: {
                    trigger: context.trigger,
                    variables: context.variables,
                    loop: context.loop,
                    error: context.error,
                },
            });

            // Process node based on type
            const processor = this.stepProcessors[node.type];
            if (!processor) {
                throw new Error(`Unknown node type: ${node.type}`);
            }

            const result = await processor(node, context, allNodes, edges, executionId, LogService);

            // Store node output in context
            context.outputs[node.id] = result;

            // Update log with success - but only if not already in a final state
            const nodeDuration = Date.now() - nodeStartTime;
            const currentLog = await LogService.readOne(logId);
            if (currentLog && currentLog.status !== "success" && currentLog.status !== "failed") {
                await LogService.updateOne(logId, {
                    status: "success",
                    outputData: result,
                    durationMs: nodeDuration,
                });

                // Only emit node completed event if we actually updated the status
                socketService.emitWorkflowExecutionUpdate(executionId, {
                    nodeId: node.id,
                    nodeStatus: "completed",
                    outputData: result,
                });
            }

            // For try/loop/condition nodes, edges are handled internally by the processor
            // Don't auto-execute their edges
            if (node.type === "try" || node.type === "loop" || node.type === "condition") {
                return result;
            }

            // Find and execute next nodes
            const nextEdges = edges.filter((e: any) => e.source === node.id);

            for (const edge of nextEdges) {
                // For condition nodes, check the sourceHandle (true/false branch)
                if (node.type === "condition" && edge.sourceHandle) {
                    const conditionResult = result.conditionMet;

                    // Only follow the edge that matches the condition result
                    if (edge.sourceHandle === "true" && !conditionResult) {
                        continue; // Skip true branch if condition is false
                    }
                    if (edge.sourceHandle === "false" && conditionResult) {
                        continue; // Skip false branch if condition is true
                    }
                }

                // Check if edge has a custom condition
                if (edge.data?.condition) {
                    const conditionMet = this.evaluateCondition(edge.data.condition, context);
                    if (!conditionMet) {
                        continue; // Skip this edge
                    }
                }

                const nextNode = allNodes.find((n: any) => n.id === edge.target);
                if (nextNode) {
                    await this.executeNode(nextNode, allNodes, edges, context, executionId, LogService);
                }
            }

            return result;
        } catch (error: any) {
            const nodeDuration = Date.now() - nodeStartTime;

            // Update the log we created earlier (using logId from creation)
            try {
                if (logId) {
                    const currentLog = await LogService.readOne(logId);
                    // Only update if not already in a final state (success or failed)
                    if (currentLog && currentLog.status !== "success" && currentLog.status !== "failed") {
                        await LogService.updateOne(logId, {
                            status: "failed",
                            errorMessage: error.message,
                            durationMs: nodeDuration,
                        });
                    }
                }
            } catch (logError) {
                // If log update fails, just log it but don't fail the workflow
                console.warn(`Failed to update log for node ${node.id}:`, logError);
            }

            // Emit node failed event
            socketService.emitWorkflowExecutionUpdate(executionId, {
                nodeId: node.id,
                nodeStatus: "failed",
                error: error.message,
            });

            throw error;
        }
    }

    /**
     * Process trigger node
     */
    async processTriggerNode(_node: any, context: any) {
        // Trigger node just passes data through
        return context.trigger;
    }

    /**
     * Process HTTP request node
     */
    async processHttpNode(node: any, context: any) {
        const { url, method = "GET", headers = {}, body, timeout = 30000 } = node.data;

        // Replace template variables in URL and body
        const processedUrl = this.replaceTemplateVariables(url, context);
        const processedHeaders = this.replaceTemplateVariables(headers, context);
        const processedBody = body ? this.replaceTemplateVariables(body, context) : undefined;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const options: any = {
                method: method.toUpperCase(),
                headers: {
                    "Content-Type": "application/json",
                    ...processedHeaders,
                },
                signal: controller.signal,
            };

            if (processedBody && ["POST", "PUT", "PATCH"].includes(options.method)) {
                options.body = typeof processedBody === "string" ? processedBody : JSON.stringify(processedBody);
            }

            const response = await fetch(processedUrl, options);
            clearTimeout(timeoutId);

            const contentType = response.headers.get("content-type");
            let responseData;

            if (contentType && contentType.includes("application/json")) {
                responseData = await response.json();
            } else {
                responseData = await response.text();
            }

            return {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                data: responseData,
            };
        } catch (error: any) {
            throw new Error(`HTTP request failed: ${error.message}`);
        }
    }

    /**
     * Process transformation node
     */
    async processTransformNode(node: any, context: any) {
        const { transformType, script, mapping } = node.data;

        try {
            if (transformType === "script") {
                // Execute JavaScript transformation
                return this.executeTransformScript(script, context);
            } else if (transformType === "mapping") {
                // Apply field mapping
                return this.applyFieldMapping(mapping, context);
            }

            throw new Error(`Unknown transform type: ${transformType}`);
        } catch (error: any) {
            throw new Error(`Transform failed: ${error.message}`);
        }
    }

    /**
     * Execute JavaScript transformation script
     */
    executeTransformScript(script: string, context: any) {
        try {
            // Create a safe execution context
            const func = new Function("context", "data", "trigger", "outputs", "loop", "variables", "error", script);
            return func(
                context,
                context.outputs[Object.keys(context.outputs).pop() || ""], // Last output
                context.trigger,
                context.outputs,
                context.loop || null, // Loop context (null if not in a loop)
                context.variables || {},
                context.error || null // Error context (null if not in catch block)
            );
        } catch (error: any) {
            throw new Error(`Script execution failed: ${error.message}`);
        }
    }

    /**
     * Apply field mapping transformation
     */
    applyFieldMapping(mapping: Record<string, any>, context: any) {
        const result: Record<string, any> = {};
        const lastOutput = context.outputs[Object.keys(context.outputs).pop() || ""];

        for (const [targetField, sourceExpression] of Object.entries(mapping)) {
            result[targetField] = this.evaluateExpression(sourceExpression, context, lastOutput);
        }

        return result;
    }

    /**
     * Process condition node
     */
    async processConditionNode(node: any, context: any, allNodes: any[], edges: any[], executionId: string | number, LogService: ItemsService) {
        const { conditions, operator = "AND" } = node.data;

        const results = conditions.map((condition: any) => {
            return this.evaluateCondition(condition, context);
        });

        let conditionMet = false;
        if (operator === "AND") {
            conditionMet = results.every((r: boolean) => r);
        } else if (operator === "OR") {
            conditionMet = results.some((r: boolean) => r);
        }

        // Find edges for true and false branches
        const trueEdges = edges.filter((e: any) => e.source === node.id && e.sourceHandle === "true");
        const falseEdges = edges.filter((e: any) => e.source === node.id && e.sourceHandle === "false");

        // Execute the appropriate branch based on condition
        const branchEdges = conditionMet ? trueEdges : falseEdges;

        for (const edge of branchEdges) {
            const nextNode = allNodes.find((n: any) => n.id === edge.target);
            if (nextNode) {
                await this.executeConditionBranch(node.id, nextNode, allNodes, edges, context, executionId, LogService);
            }
        }

        // After branch completes (via condition-end), execute "done" handle nodes
        const doneEdges = edges.filter((e: any) => e.source === node.id && e.sourceHandle === "done");
        for (const edge of doneEdges) {
            const nextNode = allNodes.find((n: any) => n.id === edge.target);
            if (nextNode) {
                await this.executeNode(nextNode, allNodes, edges, context, executionId, LogService);
            }
        }

        return { conditionMet, results, branch: conditionMet ? "true" : "false" };
    }

    /**
     * Execute a condition branch
     * Executes nodes until they connect back to the condition's "condition-end" handle
     */
    async executeConditionBranch(conditionNodeId: string, startNode: any, allNodes: any[], edges: any[], context: any, executionId: string | number, LogService: ItemsService) {
        const executedInBranch = new Set<string>();

        const executeNodeInBranch = async (currentNode: any): Promise<void> => {
            if (executedInBranch.has(currentNode.id)) {
                return;
            }

            executedInBranch.add(currentNode.id);

            // Execute the node
            const result = await this.executeSingleNode(currentNode, context, executionId, LogService, allNodes, edges);

            context.outputs[currentNode.id] = result;

            // Find outgoing edges
            const outgoingEdges = edges.filter((e: any) => e.source === currentNode.id);

            for (const edge of outgoingEdges) {
                // Check if this edge connects back to the condition node's "condition-end" handle
                if (edge.target === conditionNodeId && edge.targetHandle === "condition-end") {
                    // Branch complete, return to condition node
                    return;
                }

                // Continue executing the branch
                const nextNode = allNodes.find((n: any) => n.id === edge.target);
                if (nextNode) {
                    await executeNodeInBranch(nextNode);
                }
            }
        };

        await executeNodeInBranch(startNode);
    }

    /**
     * Evaluate a single condition
     */
    evaluateCondition(condition: any, context: any): boolean {
        const { field, operator, value } = condition;
        const fieldValue = this.evaluateExpression(field, context);

        switch (operator) {
            case "equals":
            case "==":
                return fieldValue == value;
            case "not_equals":
            case "!=":
                return fieldValue != value;
            case "greater_than":
            case ">":
                return fieldValue > value;
            case "less_than":
            case "<":
                return fieldValue < value;
            case "greater_or_equal":
            case ">=":
                return fieldValue >= value;
            case "less_or_equal":
            case "<=":
                return fieldValue <= value;
            case "contains":
                return String(fieldValue).includes(value);
            case "not_contains":
                return !String(fieldValue).includes(value);
            case "starts_with":
                return String(fieldValue).startsWith(value);
            case "ends_with":
                return String(fieldValue).endsWith(value);
            case "is_empty":
                return !fieldValue || fieldValue.length === 0;
            case "is_not_empty":
                return fieldValue && fieldValue.length > 0;
            case "in":
                return Array.isArray(value) && value.includes(fieldValue);
            case "not_in":
                return Array.isArray(value) && !value.includes(fieldValue);
            default:
                return false;
        }
    }

    /**
     * Process service operation node
     */
    async processServiceNode(node: any, context: any) {
        const {
            operation,
            collection,
            itemId,
            data,
            filter,
            sort,
            limit,
            bypassPermissions = false,
            executeAsAnonymous = false,
        } = node.data;

        const itemsService = new ItemsService(collection, {
            accountability: executeAsAnonymous ? undefined : context.accountability,
        });

        // Parse data if it's a JSON string
        let parsedData = data;
        if (typeof data === "string") {
            try {
                parsedData = JSON.parse(data);
            } catch (e) {
                // If parsing fails, keep as string
            }
        }
        const processedData = parsedData ? this.replaceTemplateVariables(parsedData, context) : undefined;

        // Parse filter if it's a JSON string
        let parsedFilter = filter;
        if (typeof filter === "string") {
            try {
                parsedFilter = JSON.parse(filter);
            } catch (e) {
                // If parsing fails, keep as string
            }
        }
        const processedFilter = parsedFilter ? this.replaceTemplateVariables(parsedFilter, context) : undefined;

        try {
            switch (operation) {
                case "create": {
                    const created = await itemsService.createOne(processedData, { bypassPermissions });
                    return created;
                }

                case "read": {
                    if (itemId) {
                        const item = await itemsService.readOne(
                            this.evaluateExpression(itemId, context),
                            {},
                            bypassPermissions
                        );
                        return item;
                    } else {
                        const items = await itemsService.readByQuery(
                            {
                                filter: processedFilter,
                                sort,
                                limit,
                            },
                            bypassPermissions
                        );
                        return items;
                    }
                }

                case "update": {
                    const updated = await itemsService.updateOne(
                        this.evaluateExpression(itemId, context),
                        processedData,
                        { bypassPermissions }
                    );
                    return updated;
                }

                case "delete": {
                    const deleted = await itemsService.deleteOne(
                        this.evaluateExpression(itemId, context),
                        { bypassPermissions }
                    );
                    return deleted;
                }

                default:
                    throw new Error(`Unknown service operation: ${operation}`);
            }
        } catch (error: any) {
            throw new Error(`Service operation failed: ${error.message}`);
        }
    }

    /**
     * Process loop node
     */
    async processLoopNode(node: any, context: any, allNodes: any[], edges: any[], executionId: string | number, LogService: ItemsService) {
        const { loopType, arraySource, startIndex = 0, endIndex, maxIterations = 1000 } = node.data;

        let items: any[] = [];

        if (loopType === "array") {
            // Get array from context
            items = this.evaluateExpression(arraySource, context);
            if (!Array.isArray(items)) {
                throw new Error("Loop source is not an array");
            }

            // Apply slice if indices specified
            if (endIndex !== undefined) {
                items = items.slice(startIndex, endIndex);
            } else if (startIndex > 0) {
                items = items.slice(startIndex);
            }
        } else if (loopType === "count") {
            // Create array of indices
            const count = Math.min(endIndex || maxIterations, maxIterations);
            items = Array.from({ length: count }, (_, i) => i + startIndex);
        }

        // Limit iterations
        items = items.slice(0, maxIterations);

        const results: any[] = [];

        // Find loop body entry edges (from "loop" source handle)
        const loopBodyEdges = edges.filter((e: any) => e.source === node.id && e.sourceHandle === "loop");

        // Execute loop iterations
        for (let i = 0; i < items.length; i++) {
            // Create loop iteration context
            const loopContext = {
                ...context,
                loop: {
                    index: i,
                    item: items[i],
                    total: items.length,
                },
            };

            // Execute loop body for each item
            const iterationResult = await this.executeLoopIteration(
                node.id,
                loopBodyEdges,
                allNodes,
                edges,
                loopContext,
                executionId,
                LogService
            );

            results.push(iterationResult);
        }

        // After all iterations complete, execute "done" handle nodes
        const doneEdges = edges.filter((e: any) => e.source === node.id && e.sourceHandle === "done");
        for (const edge of doneEdges) {
            const nextNode = allNodes.find((n: any) => n.id === edge.target);
            if (nextNode) {
                await this.executeNode(nextNode, allNodes, edges, context, executionId, LogService);
            }
        }

        return { items: results, count: results.length };
    }

    /**
     * Execute a single loop iteration
     * Executes nodes until they connect back to the loop's "loop-end" handle
     */
    async executeLoopIteration(loopNodeId: string, loopBodyEdges: any[], allNodes: any[], edges: any[], context: any, executionId: string | number, LogService: ItemsService) {
        const iterationResults: Record<string, any> = {};

        // Track which nodes have been executed in this iteration
        const executedInIteration = new Set<string>();

        // Internal function to execute a node and follow its chain
        const executeNodeInLoop = async (currentNode: any): Promise<void> => {
            // Prevent re-executing the same node in this iteration
            if (executedInIteration.has(currentNode.id)) {
                return;
            }

            executedInIteration.add(currentNode.id);

            // Execute the node
            const result = await this.executeSingleNode(currentNode, context, executionId, LogService, allNodes, edges);

            // Store result
            iterationResults[currentNode.id] = result;
            context.outputs[currentNode.id] = result;

            // Find outgoing edges from this node
            const outgoingEdges = edges.filter((e: any) => e.source === currentNode.id);

            for (const edge of outgoingEdges) {
                // Check if this edge connects back to the loop node's "loop-end" handle
                if (edge.target === loopNodeId && edge.targetHandle === "loop-end") {
                    // This marks the end of the loop body - don't continue execution
                    return;
                }

                // For condition nodes, check sourceHandle
                if (currentNode.type === "condition" && edge.sourceHandle) {
                    const conditionResult = result.conditionMet;
                    if (edge.sourceHandle === "true" && !conditionResult) {
                        continue;
                    }
                    if (edge.sourceHandle === "false" && conditionResult) {
                        continue;
                    }
                }

                // For try-catch nodes, handle based on sourceHandle
                if (currentNode.type === "try" && edge.sourceHandle) {
                    // Try-catch logic is handled internally by processTryNode
                    // We shouldn't auto-execute edges here for try nodes
                    continue;
                }

                // Continue executing the chain
                const nextNode = allNodes.find((n: any) => n.id === edge.target);
                if (nextNode && nextNode.id !== loopNodeId) {
                    await executeNodeInLoop(nextNode);
                }
            }
        };

        // Start execution from each loop body entry point
        for (const edge of loopBodyEdges) {
            const startNode = allNodes.find((n: any) => n.id === edge.target);
            if (startNode) {
                await executeNodeInLoop(startNode);
            }
        }

        return iterationResults;
    }

    /**
     * Execute a single node without following its edges
     * Used by loop iteration to have finer control over execution flow
     */
    async executeSingleNode(node: any, context: any, executionId: string | number, LogService: ItemsService, allNodes?: any[], edges?: any[]) {
        const nodeStartTime = Date.now();

        // Create execution log
        const logId = await LogService.createOne({
            execution_Id: executionId,
            nodeId: node.id,
            nodeType: node.type,
            nodeLabel: node.data?.label || node.type,
            status: "running",
            inputData: {
                trigger: context.trigger,
                variables: context.variables,
                loop: context.loop,
                error: context.error,
            },
        });

        try {
            // Get the processor for this node type
            const processor = this.stepProcessors[node.type];
            if (!processor) {
                throw new Error(`Unknown node type: ${node.type}`);
            }

            // Execute the node processor
            // For branching nodes (condition, loop, try), pass all parameters
            // For other nodes, just pass node and context
            const branchingNodeTypes = ['condition', 'loop', 'try'];
            let result;

            if (branchingNodeTypes.includes(node.type) && allNodes && edges) {
                result = await processor(node, context, allNodes, edges, executionId, LogService);
            } else {
                result = await processor(node, context);
            }

            // Update log with success - but only if not already in a final state
            const nodeDuration = Date.now() - nodeStartTime;
            const currentLog = await LogService.readOne(logId);
            if (currentLog && currentLog.status !== "success" && currentLog.status !== "failed") {
                await LogService.updateOne(logId, {
                    status: "success",
                    outputData: result,
                    durationMs: nodeDuration,
                });
            }

            return result;
        } catch (error: any) {
            const nodeDuration = Date.now() - nodeStartTime;

            // Only update if not already in a final state (success or failed)
            const currentLog = await LogService.readOne(logId);
            if (currentLog && currentLog.status !== "success" && currentLog.status !== "failed") {
                await LogService.updateOne(logId, {
                    status: "failed",
                    errorMessage: error.message,
                    durationMs: nodeDuration,
                });
            }

            throw error;
        }
    }

    /**
     * Process filter node
     */
    async processFilterNode(node: any, context: any) {
        const { arraySource, conditions, operator = "AND" } = node.data;

        const array = this.evaluateExpression(arraySource, context);
        if (!Array.isArray(array)) {
            throw new Error("Filter source is not an array");
        }

        const filtered = array.filter((item) => {
            const itemContext = { ...context, current: item };
            const results = conditions.map((cond: any) => this.evaluateCondition(cond, itemContext));

            if (operator === "AND") {
                return results.every((r: boolean) => r);
            } else {
                return results.some((r: boolean) => r);
            }
        });

        return { items: filtered, count: filtered.length };
    }

    /**
     * Process aggregate node
     */
    async processAggregateNode(node: any, context: any) {
        const { arraySource, operation, field } = node.data;

        const array = this.evaluateExpression(arraySource, context);
        if (!Array.isArray(array)) {
            throw new Error("Aggregate source is not an array");
        }

        const values = field ? array.map((item) => item[field]) : array;

        switch (operation) {
            case "count":
                return { result: array.length };
            case "sum":
                return { result: values.reduce((a, b) => a + (Number(b) || 0), 0) };
            case "average":
                return { result: values.reduce((a, b) => a + (Number(b) || 0), 0) / values.length };
            case "min":
                return { result: Math.min(...values) };
            case "max":
                return { result: Math.max(...values) };
            case "first":
                return { result: array[0] };
            case "last":
                return { result: array[array.length - 1] };
            default:
                throw new Error(`Unknown aggregate operation: ${operation}`);
        }
    }

    /**
     * Process delay node
     */
    async processDelayNode(node: any, context: any) {
        const { delay = 1000 } = node.data;
        const processedDelay = this.evaluateExpression(delay, context);

        await new Promise((resolve) => setTimeout(resolve, Number(processedDelay)));

        return { delayed: processedDelay };
    }

    /**
     * Process notification node
     */
    async processNotificationNode(node: any, context: any) {
        const {
            userId,
            title,
            message,
            type = "info",
            data,
            bypassPermissions = false,
            executeAsAnonymous = false,
        } = node.data;

        const itemsService = new ItemsService("baasix_Notification", {
            accountability: executeAsAnonymous ? undefined : context.accountability,
        });

        const processedUserId = this.evaluateExpression(userId, context);
        const processedTitle = this.replaceTemplateVariables(title, context);
        const processedMessage = this.replaceTemplateVariables(message, context);
        const processedData = data ? this.replaceTemplateVariables(data, context) : {};

        try {
            const notification = await itemsService.createOne(
                {
                    userId: processedUserId,
                    title: processedTitle,
                    message: processedMessage,
                    type,
                    data: processedData,
                    seen: false,
                },
                { bypassPermissions }
            );

            return notification;
        } catch (error: any) {
            throw new Error(`Notification failed: ${error.message}`);
        }
    }

    /**
     * Replace template variables in a value (string, object, or array)
     */
    replaceTemplateVariables(value: any, context: any): any {
        if (typeof value === "string") {
            // Replace {{variable}} syntax
            return value.replace(/\{\{(.+?)\}\}/g, (match, expression) => {
                const result = this.evaluateExpression(expression.trim(), context);
                return result !== undefined ? result : match;
            });
        } else if (Array.isArray(value)) {
            return value.map((item) => this.replaceTemplateVariables(item, context));
        } else if (typeof value === "object" && value !== null) {
            const result: Record<string, any> = {};
            for (const [key, val] of Object.entries(value)) {
                result[key] = this.replaceTemplateVariables(val, context);
            }
            return result;
        }

        return value;
    }

    /**
     * Evaluate expression to get value from context
     */
    evaluateExpression(expression: any, context: any, defaultData: any = null): any {
        if (!expression) return defaultData;

        // Handle direct context references
        if (typeof expression === "string") {
            // Parse expression to handle both dot and bracket notation
            // e.g., "outputs['service-read'].data" or "outputs.someKey.data"
            const tokens: string[] = [];
            let currentToken = "";
            let inBracket = false;

            for (let i = 0; i < expression.length; i++) {
                const char = expression[i];
                if (char === "[") {
                    if (currentToken) {
                        tokens.push(currentToken);
                        currentToken = "";
                    }
                    inBracket = true;
                } else if (char === "]") {
                    inBracket = false;
                } else if (char === "." && !inBracket) {
                    if (currentToken) {
                        tokens.push(currentToken);
                        currentToken = "";
                    }
                } else if (char !== "'" && char !== '"') {
                    currentToken += char;
                }
            }
            if (currentToken) {
                tokens.push(currentToken);
            }

            let current =
                tokens[0] === "trigger"
                    ? context.trigger
                    : tokens[0] === "outputs"
                    ? context.outputs
                    : tokens[0] === "variables"
                    ? context.variables
                    : tokens[0] === "loop"
                    ? context.loop
                    : tokens[0] === "current"
                    ? context.current
                    : defaultData;

            for (let i = 1; i < tokens.length && current; i++) {
                current = current[tokens[i]];
            }

            return current !== undefined ? current : defaultData;
        }

        return expression;
    }

    /**
     * Register hooks for workflow triggers
     */
    registerWorkflowHooks() {
        const hookAfterActions = [
            "items.read.after",
            "items.read.one.after",
            "items.create.after",
            "items.update.after",
            "items.delete.after",
        ];

        for (const action of hookAfterActions) {
            hooksManager.registerHook("*", action, async (hookData: any) => {
                const { collection, accountability, document, id, result, query, data, previousDocument } = hookData;

                // Trigger workflows with the hook data
                const workflowResult = await this.triggerWorkflowsByHook(collection, action, {
                    collection,
                    itemId: id,
                    data: document || data,
                    result,
                    query,
                    previousDocument,
                    action,
                    user: accountability?.user,
                    tenant: accountability?.tenant,
                    accountability,
                });

                // If workflow modified the data, return the modified hookData
                // Otherwise return the original hookData
                if (workflowResult && workflowResult.modifiedData) {
                    return {
                        ...hookData,
                        ...workflowResult.modifiedData,
                    };
                }

                return hookData;
            });
        }

        const hookBeforeActions = ["items.read", "items.read.one", "items.create", "items.update", "items.delete"];
        for (const action of hookBeforeActions) {
            hooksManager.registerHook("*", action, async (hookData: any) => {
                const { collection, accountability, data, id, query } = hookData;

                // Trigger workflows with the hook data
                const workflowResult = await this.triggerWorkflowsByHook(collection, action, {
                    collection,
                    itemId: id,
                    data,
                    query,
                    action,
                    user: accountability?.user,
                    tenant: accountability?.tenant,
                    accountability,
                });

                // If workflow modified the data, return the modified hookData
                // Otherwise return the original hookData
                if (workflowResult && workflowResult.modifiedData) {
                    return {
                        ...hookData,
                        ...workflowResult.modifiedData,
                    };
                }

                return hookData;
            });
        }

        console.info("WorkflowService: Registered workflow trigger hooks");
    }

    /**
     * Trigger workflows by hook event
     * @returns Object with modifiedData if workflows modified the data, null otherwise
     */
    async triggerWorkflowsByHook(collection: string, action: string, data: any) {
        try {
            // Skip workflow triggers for system tables to prevent infinite recursion
            // When workflow hooks try to read baasix_Workflow table, it would trigger hooks again
            if (collection.startsWith("baasix_")) {
                return null;
            }

            const workflowService = new ItemsService("baasix_Workflow");

            const workflowsResult = await workflowService.readByQuery({
                filter: {
                    status: "active",
                    trigger_type: "hook",
                    trigger_hook_collection: collection,
                    trigger_hook_action: action,
                },
            });

            const workflows = workflowsResult.data || [];

            // Track if any workflow modified the data
            let modifiedData: any = null;

            for (const workflow of workflows) {
                // Check role-based access for hook workflows
                if (workflow.allowed_roles && workflow.allowed_roles.length > 0) {
                    // Get user's role from accountability
                    const userRole = data.accountability?.role;

                    // If no user role, skip this workflow
                    if (!userRole) {
                        console.log(
                            `⏭️  Skipping workflow ${workflow.name} (${workflow.id}) - no user role and role restrictions apply`
                        );
                        continue;
                    }

                    // Check if user's role is in the allowed_roles array
                    const hasAccess = workflow.allowed_roles.includes(userRole);

                    if (!hasAccess) {
                        console.log(
                            `⏭️  Skipping workflow ${workflow.name} (${workflow.id}) - user does not have required role`
                        );
                        continue;
                    }
                }

                console.log(`🚀 Triggering workflow: ${workflow.name} (${workflow.id})`);

                // For "before" hooks, execute synchronously to allow data modification
                // For "after" hooks, execute asynchronously
                if (action.indexOf(".after") === -1) {
                    // This is a "before" hook - execute synchronously
                    try {
                        const executionService = new ItemsService("baasix_WorkflowExecution");

                        // Create execution record
                        const executionId = await executionService.createOne({
                            workflow_Id: workflow.id,
                            status: "queued",
                            trigger_data: data,
                            context_data: {
                                variables: { ...workflow.variables },
                                trigger: data,
                            },
                            tenant_Id: data.tenant?.id || workflow.tenant_Id,
                            triggered_by_Id: data.user?.id,
                        });

                        // Execute synchronously and wait for result
                        await this.runWorkflowExecution(executionId, workflow, data);

                        // Get the completed execution with results
                        const completedExecution = await executionService.readOne(executionId);

                        if (completedExecution.status === "completed" && completedExecution.result_data) {
                            modifiedData = modifiedData || {};

                            // Iterate through all node outputs to find hook modifications
                            // Priority: later nodes override earlier ones
                            const nodeEntries = Object.entries(completedExecution.result_data);
                            for (const [nodeId, nodeOutput] of nodeEntries) {
                                // Skip trigger nodes as they just pass through original data
                                if (nodeId.startsWith("trigger-")) continue;

                                if (!nodeOutput || typeof nodeOutput !== "object") continue;

                                // Script nodes wrap their return value in a 'result' key
                                // So if nodeOutput has a 'result' key, extract modifications from it
                                const output = (nodeOutput as any).result || nodeOutput;

                                // Check for specific modification keys in the output
                                // Workflows can return: document, data, query to modify hook data
                                if (output.document !== undefined) {
                                    modifiedData.document = output.document;
                                }
                                if (output.data !== undefined) {
                                    modifiedData.data = output.data;
                                }
                                if (output.query !== undefined) {
                                    modifiedData.query = output.query;
                                }
                            }
                        } else if (completedExecution.status === "failed") {
                            console.error(`❌ Workflow ${workflow.name} failed:`, completedExecution.errorMessage);
                            // For before hooks, throw the error to prevent the operation
                            throw new Error(completedExecution.errorMessage || "Workflow execution failed");
                        }
                    } catch (error: any) {
                        console.error(`Error executing before hook workflow ${workflow.name}:`, error);
                        // Re-throw the error so it propagates to the operation
                        throw error;
                    }
                } else {
                    // This is an "after" hook - execute asynchronously (fire and forget)
                    this.executeWorkflow(workflow.id, data, data.user?.id, data.tenant?.id).catch((error) => {
                        console.error(`Error executing after hook workflow ${workflow.name}:`, error);
                    });
                }
            }

            // Return modified data if any workflow made changes
            return modifiedData ? { modifiedData } : null;
        } catch (error) {
            console.error("Error triggering workflows by hook:", error);
            return null;
        }
    }

    /**
     * Initialize scheduled workflows
     */
    async initializeScheduledWorkflows() {
        try {
            // Check if baasix_Workflow table exists before trying to query it
            // This prevents errors during initial setup or testing
            try {
                schemaManager.getTable("baasix_Workflow");
            } catch (error) {
                console.info("WorkflowService: baasix_Workflow table not found, skipping scheduled workflow initialization");
                return;
            }

            const workflowService = new ItemsService("baasix_Workflow");

            const scheduledWorkflowsResult = await workflowService.readByQuery({
                filter: {
                    status: "active",
                    trigger_type: "schedule",
                },
            });

            const scheduledWorkflows = scheduledWorkflowsResult.data || [];

            for (const workflow of scheduledWorkflows) {
                this.scheduleWorkflow(workflow);
            }

            console.info(`WorkflowService: Initialized ${scheduledWorkflows.length} scheduled workflows`);
        } catch (error) {
            console.error("Error initializing scheduled workflows:", error);
        }
    }

    /**
     * Try to acquire distributed lock for scheduled workflow execution
     * @param workflowId - Workflow ID
     * @param lockTimeout - Lock timeout in seconds (default: 300 = 5 minutes)
     * @returns True if lock acquired, false otherwise
     */
    async tryAcquireScheduledWorkflowLock(workflowId: string | number, lockTimeout: number = 300): Promise<boolean> {
        const cache = getCache();
        const lockKey = `workflow:schedule:lock:${workflowId}`;
        const lockValue = `${process.pid}-${Date.now()}`;

        try {
            const acquired = await cache.setIfNotExists(lockKey, lockValue, lockTimeout);
            if (acquired) {
                console.info(`✓ Acquired scheduled workflow lock for: ${workflowId}`);
            }
            return acquired;
        } catch (error) {
            console.error(`Error acquiring scheduled workflow lock for ${workflowId}:`, error);
            return false;
        }
    }

    /**
     * Release distributed lock for scheduled workflow
     * @param workflowId - Workflow ID
     */
    async releaseScheduledWorkflowLock(workflowId: string | number): Promise<void> {
        const cache = getCache();
        const lockKey = `workflow:schedule:lock:${workflowId}`;

        try {
            await cache.delete(lockKey);
            console.info(`✓ Released scheduled workflow lock for: ${workflowId}`);
        } catch (error) {
            console.error(`Error releasing scheduled workflow lock for ${workflowId}:`, error);
        }
    }

    /**
     * Schedule a workflow
     */
    scheduleWorkflow(workflow: any) {
        const cron = workflow.trigger_cron;
        if (!cron) {
            console.warn(`Workflow ${workflow.id} has no cron configuration`);
            return;
        }

        try {
            // Cancel existing job if any
            if (this.scheduledJobs.has(workflow.id)) {
                this.scheduledJobs.get(workflow.id)?.cancel();
            }

            // Schedule new job with distributed locking
            const job = schedule.scheduleJob(cron, async () => {
                console.info(`⏰ Cron triggered for workflow ${workflow.id}`);

                // Try to acquire distributed lock (multi-instance safe)
                const lockAcquired = await this.tryAcquireScheduledWorkflowLock(workflow.id);

                if (!lockAcquired) {
                    console.info(`⏭️  Skipping workflow ${workflow.id} - another instance is processing it`);
                    return;
                }

                try {
                    console.info(`🚀 Executing scheduled workflow ${workflow.id}`);
                    await this.executeWorkflow(workflow.id, { scheduledAt: new Date() });
                } finally {
                    // Always release lock when done
                    await this.releaseScheduledWorkflowLock(workflow.id);
                }
            });

            if (job) {
                this.scheduledJobs.set(workflow.id, job);
                console.info(`Scheduled workflow ${workflow.id} with cron: ${cron}`);
            }
        } catch (error: any) {
            console.error(`Error scheduling workflow ${workflow.id}:`, error);
        }
    }

    /**
     * Cancel a scheduled workflow
     */
    cancelScheduledWorkflow(workflowId: string | number) {
        if (this.scheduledJobs.has(workflowId)) {
            this.scheduledJobs.get(workflowId)?.cancel();
            this.scheduledJobs.delete(workflowId);
            console.info(`Cancelled scheduled workflow ${workflowId}`);
        }
    }

    /**
     * Process email node - Send email using MailService
     */
    async processEmailNode(node: any, context: any) {
        const config = node.data || {};

        // Replace template variables
        const to = this.replaceTemplateVariables(config.to || "", context);
        const subject = this.replaceTemplateVariables(config.subject || "", context);
        const body = this.replaceTemplateVariables(config.body || "", context);
        const from = this.replaceTemplateVariables(config.from || "", context);

        // Parse recipients (can be comma-separated)
        const recipients = to
            .split(",")
            .map((email: string) => email.trim())
            .filter(Boolean);

        if (recipients.length === 0) {
            throw new Error("Email node: No recipients specified");
        }

        if (!subject || !body) {
            throw new Error("Email node: Subject and body are required");
        }

        // Send email to each recipient
        const results: any[] = [];
        for (const recipient of recipients) {
            try {
                await mailService.sendMail({
                    to: recipient,
                    from: from || undefined,
                    subject: subject,
                    html: body,
                } as any);
                results.push({ recipient, status: "sent" });
            } catch (error: any) {
                results.push({ recipient, status: "failed", error: error.message });
            }
        }

        return {
            success: true,
            sent: results.filter((r) => r.status === "sent").length,
            failed: results.filter((r) => r.status === "failed").length,
            results,
        };
    }

    /**
     * Process workflow node - Execute another workflow and return its result
     */
    async processWorkflowNode(node: any, context: any) {
        const config = node.data || {};

        if (!config.workflowId) {
            throw new Error("Workflow node: workflowId is required");
        }

        // Prepare trigger data for the child workflow
        let triggerData: any = {};

        if (config.passData) {
            // Pass specific data or entire context
            if (config.dataMapping) {
                // Map specific fields
                for (const [key, value] of Object.entries(config.dataMapping)) {
                    triggerData[key] = this.replaceTemplateVariables(value, context);
                }
            } else {
                // Pass entire context
                triggerData = { ...context };
            }
        }

        // Execute the child workflow
        const childExecution = await this.executeWorkflow(
            config.workflowId,
            triggerData,
            context.accountability?.user?.id,
            context.accountability?.tenant?.id
        );

        // Wait for completion if configured
        if (config.waitForCompletion !== false) {
            // Poll for completion (with timeout)
            const maxWaitTime = config.timeout || 300000; // 5 minutes default
            const startTime = Date.now();
            const pollInterval = 1000; // 1 second

            const executionService = new ItemsService("baasix_WorkflowExecution");

            while (Date.now() - startTime < maxWaitTime) {
                const execution = await executionService.readOne(childExecution.id);

                if (execution.status === "completed") {
                    return {
                        success: true,
                        executionId: childExecution.id,
                        status: "completed",
                        result: execution.result,
                    };
                } else if (execution.status === "failed") {
                    throw new Error(`Child workflow failed: ${execution.errorMessage}`);
                } else if (execution.status === "cancelled") {
                    throw new Error("Child workflow was cancelled");
                }

                // Wait before next poll
                await new Promise((resolve) => setTimeout(resolve, pollInterval));
            }

            throw new Error("Child workflow execution timed out");
        }

        // Don't wait - return execution ID
        return {
            success: true,
            executionId: childExecution.id,
            status: "started",
            async: true,
        };
    }

    /**
     * Process stats node - Generate statistics using StatsService
     */
    async processStatsNode(node: any, context: any) {
        const config = node.data || {};

        if (!config.collection) {
            throw new Error("Stats node: collection is required");
        }

        // Use StatsService

        const collection = this.replaceTemplateVariables(config.collection, context);
        const groupBy = config.groupBy ? this.replaceTemplateVariables(config.groupBy, context) : null;
        const operation = config.operation || "count"; // count, sum, avg, min, max

        // Build filter from template variables
        let filter = {};
        if (config.filter) {
            filter = JSON.parse(this.replaceTemplateVariables(JSON.stringify(config.filter), context));
        }

        // Get stats
        const stats = await (statsService as any).getStats({
            collection,
            groupBy: groupBy ? [groupBy] : [],
            aggregate: [
                {
                    operation,
                    field: config.field || "id",
                },
            ],
            filter,
        });

        return {
            success: true,
            collection,
            operation,
            stats,
        };
    }

    /**
     * Process file node - File operations using FilesService
     */
    async processFileNode(node: any, context: any) {
        const config = node.data || {};
        const operation = config.operation;
        const bypassPermissions = config.bypassPermissions || false;
        const executeAsAnonymous = config.executeAsAnonymous || false;

        if (!operation) {
            throw new Error("File node: operation is required");
        }

        const itemsService = new ItemsService("baasix_File", {
            accountability: executeAsAnonymous ? undefined : context.accountability,
        });

        switch (operation) {
            case "info": {
                const fileId = this.replaceTemplateVariables(config.fileId || "", context);
                if (!fileId) {
                    throw new Error("File node: fileId is required for info operation");
                }
                const fileInfo = await itemsService.readOne(fileId, {}, bypassPermissions);
                return {
                    success: true,
                    operation: "info",
                    file: fileInfo,
                };
            }

            case "delete": {
                const deleteFileId = this.replaceTemplateVariables(config.fileId || "", context);
                if (!deleteFileId) {
                    throw new Error("File node: fileId is required for delete operation");
                }
                await itemsService.deleteOne(deleteFileId, { bypassPermissions });
                return {
                    success: true,
                    operation: "delete",
                    fileId: deleteFileId,
                };
            }

            case "list": {
                const query: any = {
                    limit: config.limit || 100,
                };
                if (config.filter) {
                    query.filter = JSON.parse(this.replaceTemplateVariables(JSON.stringify(config.filter), context));
                }
                const files = await itemsService.readByQuery(query, bypassPermissions);
                return {
                    success: true,
                    operation: "list",
                    files: files.data,
                    total: (files as any).meta?.total || files.data.length,
                };
            }

            default:
                throw new Error(`File node: unknown operation "${operation}"`);
        }
    }

    /**
     * Process variable node - Set workflow variables
     */
    async processVariableNode(node: any, context: any) {
        const config = node.data || {};

        if (!config.variables || typeof config.variables !== "object") {
            throw new Error("Variable node: variables object is required");
        }

        // Set variables in context
        if (!context.variables) {
            context.variables = {};
        }

        // Process each variable with template replacement
        const setVariables: Record<string, any> = {};
        for (const [key, value] of Object.entries(config.variables)) {
            const resolvedValue = this.replaceTemplateVariables(String(value), context);
            context.variables[key] = resolvedValue;
            setVariables[key] = resolvedValue;
        }

        return {
            success: true,
            variables: setVariables,
        };
    }

    /**
     * Process script node - Execute custom JavaScript
     */
    async processScriptNode(node: any, context: any) {
        const config = node.data || {};

        if (!config.script) {
            throw new Error("Script node: script code is required");
        }

        // Create require function for ES module compatibility
        // Use a file path that works in both Jest and production
        const require = createRequire(process.cwd() + '/package.json');

        // Import commonly used libraries
        const lodash = require("lodash");
        const dayjs = require("dayjs");
        const axios = require("axios");

        // Create safe execution context with available libraries
        const sandbox: Record<string, any> = {
            // Workflow context
            context: context,
            trigger: context.trigger,
            outputs: context.outputs,
            variables: context.variables,
            loop: context.loop, // Loop iteration context (if inside a loop)

            // Built-in JavaScript
            console: console,
            JSON: JSON,
            Math: Math,
            Date: Date,
            String: String,
            Number: Number,
            Boolean: Boolean,
            Array: Array,
            Object: Object,
            Promise: Promise,
            setTimeout: setTimeout,
            setInterval: setInterval,
            clearTimeout: clearTimeout,
            clearInterval: clearInterval,

            // Utility libraries
            _: lodash, // Lodash for array/object manipulation
            lodash: lodash, // Alternative name
            dayjs: dayjs, // Date manipulation
            axios: axios, // HTTP requests

            // Helper to dynamically require other modules
            require: (moduleName: string) => {
                // Check if it's a custom registered module
                if (this.customModules.has(moduleName)) {
                    const customModule = this.customModules.get(moduleName);
                    if (customModule.allowRequire) {
                        return customModule.export;
                    } else {
                        throw new Error(`Custom module "${moduleName}" is registered but require() is disabled for it`);
                    }
                }

                // Whitelist of allowed built-in modules for security
                const allowedModules = [
                    "lodash",
                    "dayjs",
                    "axios",
                    "crypto",
                    "uuid",
                    "joi",
                    "validator",
                    "bcrypt",
                    "jsonwebtoken",
                ];

                if (!allowedModules.includes(moduleName)) {
                    const customModuleNames = Array.from(this.customModules.keys());
                    const availableModules = [...allowedModules, ...customModuleNames];
                    throw new Error(
                        `Module "${moduleName}" is not allowed. Available modules: ${availableModules.join(", ")}`
                    );
                }

                try {
                    return require(moduleName);
                } catch (error: any) {
                    throw new Error(`Failed to require module "${moduleName}": ${error.message}`);
                }
            },
        };

        // Add custom modules directly to sandbox if allowRequire is true
        for (const [moduleName, moduleInfo] of this.customModules.entries()) {
            if (moduleInfo.allowRequire) {
                // Make custom modules available as direct variables in the sandbox
                // e.g., if module name is "myUtils", it's available as both myUtils and via require('myUtils')
                sandbox[moduleName] = moduleInfo.export;
            }
        }

        try {
            // Execute script in sandboxed context
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
            const func = new AsyncFunction(...Object.keys(sandbox), config.script);
            const result = await func(...Object.values(sandbox));

            return {
                success: true,
                result: result,
            };
        } catch (error: any) {
            throw new Error(`Script execution error: ${error.message}`);
        }
    }

    /**
     * Process try-catch node - Error handling
     */
    async processTryNode(node: any, context: any, allNodes: any[], edges: any[], executionId: string | number, LogService: ItemsService) {
        // Find try and catch edges
        const tryEdges = edges.filter((e: any) => e.source === node.id && e.sourceHandle === "try");
        const catchEdges = edges.filter((e: any) => e.source === node.id && e.sourceHandle === "catch");

        let executedBranch = "try";

        try {
            // Execute try branch
            for (const edge of tryEdges) {
                const nextNode = allNodes.find((n: any) => n.id === edge.target);
                if (nextNode) {
                    await this.executeTryBranch(node.id, nextNode, allNodes, edges, context, executionId, LogService);
                }
            }
        } catch (error: any) {
            executedBranch = "catch";

            // Store error in context for catch branch
            context.error = {
                message: error.message,
                stack: error.stack,
                nodeId: node.id,
            };

            // Execute catch branch
            for (const edge of catchEdges) {
                const nextNode = allNodes.find((n: any) => n.id === edge.target);
                if (nextNode) {
                    await this.executeTryBranch(node.id, nextNode, allNodes, edges, context, executionId, LogService);
                }
            }
        }

        // After branch completes (via try-end), execute "done" handle nodes
        const doneEdges = edges.filter((e: any) => e.source === node.id && e.sourceHandle === "done");
        for (const edge of doneEdges) {
            const nextNode = allNodes.find((n: any) => n.id === edge.target);
            if (nextNode) {
                await this.executeNode(nextNode, allNodes, edges, context, executionId, LogService);
            }
        }

        return {
            success: true,
            branch: executedBranch,
            error: context.error || null,
        };
    }

    /**
     * Execute a try/catch branch
     * Executes nodes until they connect back to the try node's "try-end" handle
     */
    async executeTryBranch(tryNodeId: string, startNode: any, allNodes: any[], edges: any[], context: any, executionId: string | number, LogService: ItemsService) {
        const executedInBranch = new Set<string>();

        const executeNodeInBranch = async (currentNode: any): Promise<void> => {
            if (executedInBranch.has(currentNode.id)) {
                return;
            }

            executedInBranch.add(currentNode.id);

            // Execute the node
            const result = await this.executeSingleNode(currentNode, context, executionId, LogService, allNodes, edges);

            context.outputs[currentNode.id] = result;

            // Find outgoing edges
            const outgoingEdges = edges.filter((e: any) => e.source === currentNode.id);

            for (const edge of outgoingEdges) {
                // Check if this edge connects back to the try node's "try-end" handle
                if (edge.target === tryNodeId && edge.targetHandle === "try-end") {
                    // Branch complete, return to try node
                    return;
                }

                // Continue executing the branch
                const nextNode = allNodes.find((n: any) => n.id === edge.target);
                if (nextNode) {
                    await executeNodeInBranch(nextNode);
                }
            }
        };

        await executeNodeInBranch(startNode);
    }

    /**
     * Execute a single node (for testing individual steps)
     */
    async executeSingleNodeFromAPI(
        workflowId: string | number,
        nodeId: string,
        inputData: any,
        userId: any,
        tenantId: any,
        workflowData: any = null
    ) {
        await this.ensureInitialized();

        const workflowService = new ItemsService("baasix_Workflow");

        try {
            // Use provided workflow data or fetch it
            const workflow = workflowData || (await workflowService.readOne(workflowId));
            if (!workflow) {
                throw new Error(`Workflow ${workflowId} not found`);
            }

            // Find the node to execute
            const { nodes, edges } = workflow.flow_data;
            const node = nodes.find((n: any) => n.id === nodeId);
            if (!node) {
                throw new Error(`Node ${nodeId} not found in workflow`);
            }

            // Create minimal context with provided input data
            const context: any = {
                variables: { ...workflow.variables },
                trigger: inputData.trigger || {},
                outputs: inputData.outputs || {},
                loop: inputData.loop || null,
                error: inputData.error || null,
            };

            // Process the node
            const processor = this.stepProcessors[node.type];
            if (!processor) {
                throw new Error(`Unknown node type: ${node.type}`);
            }

            const result = await processor(node, context, nodes, edges, null, null);

            return {
                success: true,
                nodeId,
                nodeType: node.type,
                input: {
                    trigger: context.trigger,
                    variables: context.variables,
                    loop: context.loop,
                    error: context.error,
                },
                output: result,
                workflow: workflow, // Return workflow for route to use
            };
        } catch (error: any) {
            console.error(`Single node execution ${nodeId} failed:`, error);
            throw error;
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        console.info("WorkflowService: Starting graceful shutdown...");

        // Cancel all scheduled jobs
        for (const [workflowId, job] of this.scheduledJobs) {
            job.cancel();
            console.info(`Cancelled scheduled workflow ${workflowId}`);
        }

        this.scheduledJobs.clear();
        console.info("WorkflowService: Shutdown completed");
    }
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_workflowService: WorkflowService | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_workflowService) {
  globalThis.__baasix_workflowService = new WorkflowService();
}

const workflowService = globalThis.__baasix_workflowService;

export default workflowService;
