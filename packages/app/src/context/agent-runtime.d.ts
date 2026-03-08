import type { MeridianProviderAuth } from "@zulip/desktop/bindings";
export interface DelegateAgentRuntimeShape {
    id: string;
    name: string;
    purpose: string;
    theme: string;
    soul: string;
    enabled: boolean;
    delegateEligible: boolean;
    inheritRuntimePreset: boolean;
    inheritProviders: boolean;
    inheritMcp: boolean;
    inheritChannels: boolean;
    inheritSkills: boolean;
    providerOverride: string | null;
    preferredModel: string;
}
export declare function getProviderConnectionStatus(provider: MeridianProviderAuth): string;
export declare function getProviderDefaultModel(provider: MeridianProviderAuth): string | null;
export declare function normalizeProvider(provider: MeridianProviderAuth): MeridianProviderAuth;
export declare function buildSupervisorDelegateContextFromDelegates(delegates: DelegateAgentRuntimeShape[]): string | null;
export declare function wrapSupervisorMessageWithDelegates(message: string, delegateContext: string | null): string;
export declare function unwrapSupervisorMessageWithDelegates(message: string): string;
//# sourceMappingURL=agent-runtime.d.ts.map