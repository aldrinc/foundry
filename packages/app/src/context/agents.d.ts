import { type JSX } from "solid-js";
import type { FoundryProviderAuth } from "@zulip/desktop/bindings";
export type AgentScopeMode = "all_topics" | "selected_streams";
export interface DelegateAgent {
    id: string;
    name: string;
    emoji: string;
    purpose: string;
    theme: string;
    soul: string;
    enabled: boolean;
    delegateEligible: boolean;
    scopeMode: AgentScopeMode;
    streamIds: number[];
    inheritRuntimePreset: boolean;
    inheritProviders: boolean;
    inheritMcp: boolean;
    inheritChannels: boolean;
    inheritSkills: boolean;
    providerOverride: string | null;
    preferredModel: string;
    createdAt: string;
    updatedAt: string;
}
export interface DelegateTemplate {
    id: string;
    name: string;
    emoji: string;
    purpose: string;
    theme: string;
    soul: string;
}
export declare const DELEGATE_TEMPLATES: DelegateTemplate[];
export interface AgentsStore {
    delegates: DelegateAgent[];
    providers: FoundryProviderAuth[];
    loading: boolean;
    providersLoading: boolean;
    providerError: string;
}
export interface AgentsContextValue {
    store: AgentsStore;
    upsertAgent(agent: DelegateAgent): Promise<{
        ok: boolean;
        error?: string;
    }>;
    deleteAgent(id: string): Promise<void>;
    refreshProviders(): Promise<void>;
    availableDelegatesForStream(streamId: number | null): DelegateAgent[];
    buildSupervisorDelegateContext(streamId: number | null): string | null;
}
export declare function AgentsProvider(props: {
    orgId: string;
    children: JSX.Element;
}): JSX.Element;
export declare function useAgents(): AgentsContextValue;
export declare function createAgentFromTemplate(template: DelegateTemplate, existingIds: string[]): DelegateAgent;
//# sourceMappingURL=agents.d.ts.map