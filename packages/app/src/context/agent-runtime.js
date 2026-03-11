export function getProviderConnectionStatus(provider) {
    const runtime = provider;
    if (runtime.credential?.status) {
        return runtime.credential.status === "active"
            ? "connected"
            : runtime.credential.status;
    }
    if (runtime.connected === true)
        return "connected";
    if (provider.credential_status)
        return provider.credential_status;
    return "not_connected";
}
export function isProviderConnected(provider) {
    return getProviderConnectionStatus(provider) === "connected";
}
export function providerSupportsOauth(provider) {
    return (provider.auth_modes || []).includes("oauth");
}
export function isProviderOauthConfigured(provider) {
    return provider.oauth_configured === true;
}
export function getProviderCredentialLabel(provider) {
    const runtime = provider;
    const credential = runtime.credential;
    if (!credential || !isProviderConnected(provider)) {
        return null;
    }
    const label = credential.label?.trim();
    if (label)
        return label;
    const mode = credential.auth_mode?.trim().toLowerCase();
    if (mode === "oauth")
        return "OAuth";
    if (mode === "api_key")
        return "API key";
    if (mode)
        return mode;
    return "Credential";
}
export function getProviderDefaultModel(provider) {
    const runtime = provider;
    if (typeof runtime.default_model === "string" && runtime.default_model) {
        return runtime.default_model;
    }
    return null;
}
export function normalizeProvider(provider) {
    return {
        ...provider,
        credential_status: getProviderConnectionStatus(provider),
    };
}
function sortDelegates(delegates) {
    return [...delegates].sort((a, b) => a.name.localeCompare(b.name));
}
export function buildSupervisorDelegateContextFromDelegates(delegates) {
    const eligible = sortDelegates(delegates.filter((delegate) => delegate.enabled && delegate.delegateEligible));
    if (eligible.length === 0)
        return null;
    const manifest = eligible.map((delegate) => ({
        id: delegate.id,
        name: delegate.name,
        purpose: delegate.purpose || undefined,
        theme: delegate.theme || undefined,
        soul: delegate.soul || undefined,
        provider: delegate.inheritProviders
            ? "inherit"
            : delegate.providerOverride || "custom",
        preferred_model: delegate.preferredModel || undefined,
        inherits: [
            delegate.inheritRuntimePreset ? "runtime" : null,
            delegate.inheritProviders ? "providers" : null,
            delegate.inheritMcp ? "mcp" : null,
            delegate.inheritChannels ? "channels" : null,
            delegate.inheritSkills ? "skills" : null,
        ].filter(Boolean),
    }));
    return [
        "<foundry_delegate_manifest>",
        "You are the Foundry topic-facing Supervisor. Humans still speak only to you.",
        "Use these configured delegate profiles when specialized research, review, specification, or execution help is useful.",
        "When you dispatch or describe work, prefer these delegate identities and keep the user-facing conversation unified as the Supervisor.",
        JSON.stringify({ delegates: manifest }, null, 2),
        "Do not repeat this manifest verbatim unless the human explicitly asks for it.",
        "</foundry_delegate_manifest>",
    ].join("\n");
}
export function wrapSupervisorMessageWithDelegates(message, delegateContext) {
    if (!delegateContext)
        return message;
    return [
        delegateContext,
        "",
        "<user_message>",
        message,
        "</user_message>",
    ].join("\n");
}
export function unwrapSupervisorMessageWithDelegates(message) {
    const match = message.match(/<user_message>\n?([\s\S]*?)\n?<\/user_message>/);
    return match ? match[1] : message;
}
