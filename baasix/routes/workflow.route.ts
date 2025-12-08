import { Express } from "express";
import { APIError } from "../utils/errorHandler.js";
import workflowService from "../services/WorkflowService.js";
import ItemsService from "../services/ItemsService.js";
import fileUpload from "express-fileupload";
import {
    fetchWorkflowForExecution,
    validateWorkflowAccess
} from "../utils/workflow.js";

const registerEndpoint = (app: Express) => {

    /**
     * Execute a workflow manually
     */
    app.post("/workflows/:id/execute", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            const { id } = req.params;
            const triggerData = req.body || {};

            // Fetch workflow and validate access
            const workflow = await fetchWorkflowForExecution(id);
            validateWorkflowAccess(workflow, req.accountability);

            // Create execution record first and return immediately
            const executionRecord = await workflowService.createExecutionRecord(
                id,
                req.accountability.user.id,
                req.accountability.tenant?.id
            );

            console.log(`📝 Created execution record: ${executionRecord.id}`);

            // Return execution ID immediately so frontend can join socket room
            res.json({
                message: "Workflow execution started",
                execution: executionRecord,
            });

            console.log(`⏱️ Waiting 500ms for frontend to join socket room...`);

            // Give frontend time to join socket room before starting execution (500ms)
            setTimeout(() => {
                console.log(`🚀 Starting workflow execution: ${executionRecord.id}`);
                // Execute workflow asynchronously in background (don't await)
                workflowService.executeWorkflowAsync(
                    id,
                    triggerData,
                    req.accountability.user.id,
                    req.accountability.tenant?.id,
                    executionRecord.id
                ).catch((error: any) => {
                    console.error("Workflow execution error:", error);
                });
            }, 500);
        } catch (error) {
            next(error);
        }
    });

    /**
     * Execute a single node (for testing individual steps)
     */
    app.post("/workflows/:id/nodes/:nodeId/execute", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            const { id, nodeId } = req.params;
            const { inputData } = req.body;

            // Fetch workflow with flow_data for execution
            const workflow = await fetchWorkflowForExecution(id, true);
            validateWorkflowAccess(workflow, req.accountability);

            // Execute node, passing the already-fetched workflow to avoid re-fetching
            const result = await workflowService.executeSingleNodeFromAPI(
                id,
                nodeId,
                inputData || {},
                req.accountability.user.id,
                req.accountability.tenant?.id,
                workflow // Pass workflow to avoid re-fetching
            );

            res.json({
                message: "Node executed successfully",
                result,
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * Get workflow execution status
     */
    app.get("/workflows/:id/executions/:executionId", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            const { executionId } = req.params;

            const itemsService = new ItemsService("baasix_WorkflowExecution", {
                accountability: req.accountability,
            });

            const execution = await itemsService.readOne(executionId, {
                fields: ["*", "logs.*"],
            });

            res.json({ data: execution });
        } catch (error) {
            next(error);
        }
    });

    /**
     * Get workflow executions with filtering and pagination
     */
    app.get("/workflows/:id/executions", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            const { id } = req.params;

            // Parse query parameters
            const query: any = {
                filter: {},
                limit: req.query.limit ? parseInt(req.query.limit) : 25,
                page: req.query.page ? parseInt(req.query.page) : 1,
            };

            if (req.query.sort) {
                query.sort = req.query.sort;
            }

            const itemsService = new ItemsService("baasix_WorkflowExecution", {
                accountability: req.accountability,
            });

            // Add workflow filter
            let filter: any = { workflow_Id: id };
            if (req.query.filter) {
                try {
                    const userFilter = JSON.parse(req.query.filter as string);
                    filter = { AND: [userFilter, { workflow_Id: id }] };
                } catch (e) {
                    filter = { workflow_Id: id };
                }
            }
            query.filter = filter;

            const executions = await itemsService.readByQuery(query);

            res.json(executions);
        } catch (error) {
            next(error);
        }
    });

    /**
     * Cancel a running workflow execution
     */
    app.post("/workflows/:id/executions/:executionId/cancel", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            const { executionId } = req.params;

            const itemsService = new ItemsService("baasix_WorkflowExecution", {
                accountability: req.accountability,
            });

            await itemsService.updateOne(executionId, {
                status: "cancelled",
                completedAt: new Date(),
            });

            const execution = await itemsService.readOne(executionId);

            res.json({
                message: "Workflow execution cancelled",
                execution,
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * Test a workflow with sample data (doesn't save execution)
     */
    app.post("/workflows/:id/test", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            const { id } = req.params;
            const { triggerData = {}, saveExecution = false } = req.body;

            const workflowItemsService = new ItemsService("baasix_Workflow", {
                accountability: req.accountability,
            });

            const workflow = await workflowItemsService.readOne(id);

            if (!workflow) {
                throw new APIError("Workflow not found", 404);
            }

            // Execute workflow
            const execution = await workflowService.executeWorkflow(
                id,
                triggerData,
                req.accountability.user.id,
                req.accountability.tenant?.id
            );

            // If not saving execution, mark it for deletion after returning
            if (!saveExecution) {
                const executionService = new ItemsService("baasix_WorkflowExecution", {
                    accountability: req.accountability,
                });
                // Schedule deletion after 5 minutes
                setTimeout(async () => {
                    try {
                        await executionService.deleteOne(execution.id);
                    } catch (error) {
                        console.error("Error deleting test execution:", error);
                    }
                }, 5 * 60 * 1000);
            }

            res.json({
                message: "Workflow test execution started",
                execution,
                note: saveExecution ? "Execution will be saved" : "Execution will be deleted after 5 minutes",
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * Get workflow execution logs
     */
    app.get("/workflows/:id/executions/:executionId/logs", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            const { executionId } = req.params;

            const itemsService = new ItemsService("baasix_WorkflowExecutionLog", {
                accountability: req.accountability,
            });

            const logs = await itemsService.readByQuery({
                filter: { execution_Id: executionId },
            });

            res.json(logs);
        } catch (error) {
            next(error);
        }
    });

    /**
     * Get workflow statistics
     */
    app.get("/workflows/:id/stats", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            const { id } = req.params;

            const itemsService = new ItemsService("baasix_WorkflowExecution", {
                accountability: req.accountability,
            });

            // Get execution counts by status
            const executions = await itemsService.readByQuery({
                filter: { workflow_Id: id },
                fields: ["status", "durationMs", "createdAt"],
                limit: -1,
            });

            const stats: any = {
                total: executions.data.length,
                byStatus: {
                    queued: 0,
                    running: 0,
                    completed: 0,
                    failed: 0,
                    cancelled: 0,
                },
                avgDuration: 0,
                totalDuration: 0,
                lastExecution: null,
            };

            let totalDuration = 0;
            let durationCount = 0;

            for (const exec of executions.data) {
                stats.byStatus[exec.status]++;

                if (exec.durationMs) {
                    totalDuration += exec.durationMs;
                    durationCount++;
                }

                if (!stats.lastExecution || new Date(exec.createdAt) > new Date(stats.lastExecution)) {
                    stats.lastExecution = exec.createdAt;
                }
            }

            stats.avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;
            stats.totalDuration = totalDuration;

            res.json(stats);
        } catch (error) {
            next(error);
        }
    });

    /**
     * Trigger webhook workflow with custom path
     * Catch-all route for custom webhook paths
     */
    app.all("/webhook/*", async (req: any, res: any, next: any) => {
        try {
            // Extract the webhook path (everything after /webhook)
            const webhookPath = req.path.replace(/^\/webhook/, "") || "/";
            const method = req.method.toUpperCase();

            const triggerData = {
                body: req.body,
                query: req.query,
                headers: req.headers,
                method: req.method,
                path: webhookPath,
            };

            // Fetch workflow by webhook path and method
            const itemsService = new ItemsService("baasix_Workflow");
            const workflowsResult = await itemsService.readByQuery({
                filter: {
                    status: "active",
                    trigger_type: "webhook",
                    trigger_webhook_path: webhookPath,
                    trigger_webhook_method: method,
                },
                fields: ["id", "status", "trigger_type", "allowed_roles"],
                limit: 1,
            });

            if (!workflowsResult.data || workflowsResult.data.length === 0) {
                throw new APIError(`Webhook not found for ${method} ${webhookPath} or workflow is not active`, 404);
            }

            const workflow = workflowsResult.data[0];

            // Validate role-based access
            validateWorkflowAccess(workflow, req.accountability);

            const execution = await workflowService.executeWorkflow(
                workflow.id,
                triggerData,
                req.accountability?.user?.id,
                req.accountability?.tenant?.id
            );

            res.json({
                message: "Workflow triggered successfully",
                execution: {
                    id: execution.id,
                    status: execution.status,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * Validate workflow configuration
     */
    app.post("/workflows/validate", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            const { flow_data } = req.body;

            if (!flow_data || !flow_data.nodes || !flow_data.edges) {
                throw new APIError("Invalid workflow data", 400);
            }

            const errors: string[] = [];
            const warnings: string[] = [];

            // Check for trigger node
            const triggerNodes = flow_data.nodes.filter((n: any) => n.type === "trigger");
            if (triggerNodes.length === 0) {
                errors.push("Workflow must have exactly one trigger node");
            } else if (triggerNodes.length > 1) {
                errors.push("Workflow can only have one trigger node");
            }

            // Check trigger node has only one outgoing edge
            if (triggerNodes.length === 1) {
                const triggerOutgoingEdges = flow_data.edges.filter((e: any) => e.source === triggerNodes[0].id);
                if (triggerOutgoingEdges.length === 0) {
                    errors.push("Trigger node must have at least one outgoing connection");
                } else if (triggerOutgoingEdges.length > 1) {
                    errors.push("Trigger node can only have one outgoing connection");
                }
            }

            // Check that all non-trigger nodes have at least one incoming edge
            for (const node of flow_data.nodes) {
                if (node.type !== "trigger") {
                    const incomingEdges = flow_data.edges.filter((e: any) => e.target === node.id);
                    if (incomingEdges.length === 0) {
                        errors.push(`Node "${node.data?.label || node.type}" (${node.id}) has no incoming connection`);
                    }
                }
            }

            // Build connected nodes set
            const connectedNodes = new Set<string>();
            for (const edge of flow_data.edges) {
                connectedNodes.add(edge.source);
                connectedNodes.add(edge.target);
            }

            const orphanedNodes = flow_data.nodes.filter(
                (n: any) => n.type !== "trigger" && !connectedNodes.has(n.id)
            );

            if (orphanedNodes.length > 0) {
                errors.push(`Found ${orphanedNodes.length} disconnected nodes that will not be executed`);
            }

            // Check for circular dependencies (simplified check)
            const visited = new Set<string>();
            const recursionStack = new Set<string>();

            const hasCycle = (nodeId: string): boolean => {
                if (recursionStack.has(nodeId)) return true;
                if (visited.has(nodeId)) return false;

                visited.add(nodeId);
                recursionStack.add(nodeId);

                const outgoingEdges = flow_data.edges.filter((e: any) => e.source === nodeId);
                for (const edge of outgoingEdges) {
                    if (hasCycle(edge.target)) return true;
                }

                recursionStack.delete(nodeId);
                return false;
            };

            if (triggerNodes.length > 0 && hasCycle(triggerNodes[0].id)) {
                errors.push("Workflow contains circular dependencies");
            }

            // Check node configurations
            for (const node of flow_data.nodes) {
                const nodeLabel = node.data?.label || node.type;

                if (node.type === "http" && !node.data?.url) {
                    errors.push(`HTTP node "${nodeLabel}" is missing URL configuration`);
                }
                if (node.type === "service" && !node.data?.collection) {
                    errors.push(`Service node "${nodeLabel}" is missing collection configuration`);
                }
                if (node.type === "condition" && (!node.data?.conditions || node.data.conditions.length === 0)) {
                    errors.push(`Condition node "${nodeLabel}" has no conditions defined`);
                }
                if (node.type === "email") {
                    if (!node.data?.to) {
                        errors.push(`Email node "${nodeLabel}" is missing recipient email(s)`);
                    }
                    if (!node.data?.subject) {
                        errors.push(`Email node "${nodeLabel}" is missing subject`);
                    }
                    if (!node.data?.body) {
                        errors.push(`Email node "${nodeLabel}" is missing email body`);
                    }
                }
                if (node.type === "workflow" && !node.data?.workflowId) {
                    errors.push(`Workflow node "${nodeLabel}" is missing target workflow ID`);
                }
                if (node.type === "loop" && !node.data?.array) {
                    errors.push(`Loop node "${nodeLabel}" is missing array source`);
                }
                if (node.type === "stats") {
                    if (!node.data?.collection) {
                        errors.push(`Stats node "${nodeLabel}" is missing collection`);
                    }
                    if (!node.data?.operation) {
                        errors.push(`Stats node "${nodeLabel}" is missing operation type`);
                    }
                }
                if (node.type === "file") {
                    if (!node.data?.operation) {
                        errors.push(`File node "${nodeLabel}" is missing operation type`);
                    }
                    if ((node.data?.operation === "info" || node.data?.operation === "delete") && !node.data?.fileId) {
                        errors.push(`File node "${nodeLabel}" is missing file ID for ${node.data.operation} operation`);
                    }
                }
                if (node.type === "variable") {
                    if (!node.data?.variables || Object.keys(node.data.variables).length === 0) {
                        warnings.push(`Variable node "${nodeLabel}" has no variables defined`);
                    }
                }
                if (node.type === "script" && !node.data?.script) {
                    errors.push(`Script node "${nodeLabel}" is missing script code`);
                }
            }

            res.json({
                valid: errors.length === 0,
                errors,
                warnings,
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * Export workflow(s) as JSON
     */
    app.post("/workflows/export", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            // Only administrators can export workflows
            if (req.accountability.role?.name !== 'administrator' && req.accountability.role?.name !== 'Administrator') {
                throw new APIError("Only administrators can export workflows", 403);
            }

            const { workflowIds } = req.body;

            if (!workflowIds || !Array.isArray(workflowIds) || workflowIds.length === 0) {
                throw new APIError("workflowIds array is required", 400);
            }

            const itemsService = new ItemsService("baasix_Workflow", {
                accountability: req.accountability,
            });

            const workflows = await itemsService.readByQuery({
                filter: { "id": { in: workflowIds } },
                fields: [
                    "id",
                    "name",
                    "description",
                    "status",
                    "trigger_type",
                    "trigger_cron",
                    "trigger_webhook_path",
                    "trigger_webhook_method",
                    "trigger_hook_collection",
                    "trigger_hook_action",
                    "allowed_roles",
                    "flow_data",
                    "variables",
                    "options",
                ],
                limit: -1,
            });

            // Create export data with metadata
            const exportData = {
                version: "1.0",
                exportedAt: new Date().toISOString(),
                exportedBy: req.accountability.user.id,
                workflows: workflows.data,
            };

            res.json({
                message: `Exported ${workflows.data.length} workflow(s)`,
                data: exportData,
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * Import workflow(s) from JSON
     * Supports overwriting existing workflows with confirmation
     */
    app.post("/workflows/import", fileUpload(), async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            // Only administrators can import workflows
            if (req.accountability.role?.name !== 'administrator' && req.accountability.role?.name !== 'Administrator') {
                throw new APIError("Only administrators can import workflows", 403);
            }

            // Check if data is coming from file upload or direct JSON
            let workflows: any[];
            let overwrite = false;

            if (req.files && req.files.file) {
                // Handle file upload
                const file = req.files.file as any;
                const fileContent = file.data.toString('utf8');
                const importData = JSON.parse(fileContent);

                // Handle both formats: direct workflows array or nested in data.workflows
                if (importData.data && importData.data.workflows) {
                    workflows = importData.data.workflows;
                } else if (importData.workflows) {
                    workflows = importData.workflows;
                } else {
                    throw new APIError("Invalid import file format", 400);
                }

                overwrite = req.body.overwrite === 'true' || req.body.overwrite === true;
            } else if (req.body.workflows) {
                // Handle direct JSON
                workflows = req.body.workflows;
                overwrite = req.body.overwrite === 'true' || req.body.overwrite === true;
            } else {
                throw new APIError("workflows array or file is required", 400);
            }

            if (!workflows || !Array.isArray(workflows) || workflows.length === 0) {
                throw new APIError("workflows array is required", 400);
            }

            const itemsService = new ItemsService("baasix_Workflow", {
                accountability: req.accountability,
            });

            const results: any = {
                created: [],
                updated: [],
                skipped: [],
                errors: [],
            };

            // Check for existing workflows
            const workflowIds = workflows.map((w: any) => w.id).filter(Boolean);

            // Check for existing workflows including soft-deleted ones
            const existingWorkflows = workflowIds.length > 0
                ? await itemsService.readByQuery({
                    filter: { id: { in: workflowIds } },
                    fields: ["id", "name", "deletedAt"],
                    paranoid: false, // Include soft-deleted records
                })
                : { data: [] };

            const existingMap = new Map(existingWorkflows.data.map((w: any) => [w.id, w]));

            for (const workflow of workflows) {
                try {
                    const workflowData: any = {
                        id: workflow.id,
                        name: workflow.name,
                        description: workflow.description,
                        status: workflow.status || "draft", // Import as draft by default for safety
                        trigger_type: workflow.trigger_type,
                        trigger_cron: workflow.trigger_cron,
                        trigger_webhook_path: workflow.trigger_webhook_path,
                        trigger_webhook_method: workflow.trigger_webhook_method,
                        trigger_hook_collection: workflow.trigger_hook_collection,
                        trigger_hook_action: workflow.trigger_hook_action,
                        allowed_roles: workflow.allowed_roles || [],
                        flow_data: workflow.flow_data,
                        variables: workflow.variables || {},
                        options: workflow.options || {},
                        deletedAt: null, // Explicitly restore if previously deleted
                    };

                    const existingWorkflow = existingMap.get(workflow.id);
                    const exists = !!existingWorkflow;

                    if (exists && !overwrite) {
                        results.skipped.push({
                            id: workflow.id,
                            name: workflow.name,
                            reason: "Workflow already exists (use overwrite=true to replace)",
                        });
                    } else if (exists && overwrite) {
                        // Update existing workflow (including restoring if deleted)
                        if (existingWorkflow.deletedAt) {
                            // For soft-deleted records, restore first
                            await itemsService.updateOne(workflow.id, { deletedAt: null });
                        }
                        await itemsService.updateOne(workflow.id, workflowData);
                        results.updated.push({
                            id: workflow.id,
                            name: workflow.name,
                        });
                    } else {
                        // Create new workflow - createOne returns only ID in Drizzle
                        const createdId = await itemsService.createOne(workflowData);
                        results.created.push({
                            id: createdId,
                            name: workflowData.name,
                        });
                    }
                } catch (error: any) {
                    results.errors.push({
                        workflow: workflow.id || workflow.name,
                        error: error.message,
                    });
                }
            }

            res.json({
                message: "Import completed",
                results,
                summary: {
                    total: workflows.length,
                    created: results.created.length,
                    updated: results.updated.length,
                    skipped: results.skipped.length,
                    errors: results.errors.length,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * Export single workflow by ID
     */
    app.get("/workflows/:id/export", async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            // Only administrators can export workflows
            if (req.accountability.role?.name !== 'administrator' && req.accountability.role?.name !== 'Administrator') {
                throw new APIError("Only administrators can export workflows", 403);
            }

            const { id } = req.params;

            const itemsService = new ItemsService("baasix_Workflow", {
                accountability: req.accountability,
            });

            const workflow = await itemsService.readOne(id, {
                fields: [
                    "id",
                    "name",
                    "description",
                    "status",
                    "trigger_type",
                    "trigger_cron",
                    "trigger_webhook_path",
                    "trigger_webhook_method",
                    "trigger_hook_collection",
                    "trigger_hook_action",
                    "allowed_roles",
                    "flow_data",
                    "variables",
                    "options",
                ],
            });

            // Create export data with metadata
            const exportData = {
                version: "1.0",
                exportedAt: new Date().toISOString(),
                exportedBy: req.accountability.user.id,
                workflows: [workflow],
            };

            res.json({
                message: "Workflow exported",
                data: exportData,
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * Check for existing workflows before import (preview)
     */
    app.post("/workflows/import/preview", fileUpload(), async (req: any, res: any, next: any) => {
        try {
            if (!req.accountability?.user?.id) {
                throw new APIError("Authentication required", 401);
            }

            // Only administrators can preview workflow imports
            if (req.accountability.role?.name !== 'administrator' && req.accountability.role?.name !== 'Administrator') {
                throw new APIError("Only administrators can import workflows", 403);
            }

            // Check if data is coming from file upload or direct JSON
            let workflows: any[];

            if (req.files && req.files.file) {
                // Handle file upload
                const file = req.files.file as any;
                const fileContent = file.data.toString('utf8');
                const importData = JSON.parse(fileContent);

                // Handle both formats: direct workflows array or nested in data.workflows
                if (importData.data && importData.data.workflows) {
                    workflows = importData.data.workflows;
                } else if (importData.workflows) {
                    workflows = importData.workflows;
                } else {
                    throw new APIError("Invalid import file format", 400);
                }
            } else if (req.body.workflows) {
                // Handle direct JSON
                workflows = req.body.workflows;
            } else {
                throw new APIError("workflows array or file is required", 400);
            }

            if (!workflows || !Array.isArray(workflows) || workflows.length === 0) {
                throw new APIError("workflows array is required", 400);
            }

            // Check for existing workflows including soft-deleted ones
            const workflowIds = workflows.map((w: any) => w.id).filter(Boolean);
            const itemsService = new ItemsService("baasix_Workflow", {
                accountability: req.accountability,
            });

            const existingWorkflows = workflowIds.length > 0
                ? await itemsService.readByQuery({
                    filter: { id: { in: workflowIds } },
                    fields: ["id", "name", "status", "updatedAt", "deletedAt"],
                    paranoid: false, // Include soft-deleted records
                })
                : { data: [] };

            const existingMap = new Map(existingWorkflows.data.map((w: any) => [w.id, w]));

            const conflicts: any[] = [];
            const newWorkflows: any[] = [];

            workflows.forEach((workflow: any) => {
                const existing = existingMap.get(workflow.id);
                if (existing) {
                    conflicts.push({
                        id: workflow.id,
                        name: workflow.name,
                        trigger_type: workflow.trigger_type,
                        existing: {
                            name: existing.name,
                            status: existing.status,
                            lastUpdated: existing.updatedAt,
                            isDeleted: !!existing.deletedAt,
                        },
                    });
                } else {
                    newWorkflows.push({
                        id: workflow.id,
                        name: workflow.name,
                        trigger_type: workflow.trigger_type,
                    });
                }
            });

            res.json({
                total: workflows.length,
                new: newWorkflows.length,
                conflicts: conflicts,
            });
        } catch (error) {
            next(error);
        }
    });
};

export default {
    id: "workflows",
    handler: registerEndpoint,
};
