import { createSignal, Show } from "solid-js";
import { usePlatform } from "../context/platform";
import { commands } from "@zulip/desktop/bindings";
/**
 * Login view — server URL input + authentication form.
 */
export function LoginView(props) {
    const platform = usePlatform();
    const [serverUrl, setServerUrl] = createSignal("");
    const [email, setEmail] = createSignal("");
    const [apiKey, setApiKey] = createSignal("");
    const [step, setStep] = createSignal("server");
    const [error, setError] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [serverName, setServerName] = createSignal("");
    const handleConnect = async () => {
        const url = serverUrl().trim();
        if (!url) {
            setError("Please enter a server URL");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const result = await commands.getServerSettings(url);
            if (result.status === "error") {
                setError(result.error);
                return;
            }
            setServerName(result.data.realm_name || url);
            setStep("auth");
        }
        catch (e) {
            setError(e?.toString() || "Failed to connect to server");
        }
        finally {
            setLoading(false);
        }
    };
    const handleLogin = async () => {
        const url = serverUrl().trim();
        const userEmail = email().trim();
        const key = apiKey().trim();
        if (!userEmail || !key) {
            setError("Please enter your email and API key");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const result = await commands.login(url, userEmail, key);
            if (result.status === "error") {
                setError(result.error);
                return;
            }
            // Save server for auto-login next time
            await commands.addServer({
                id: result.data.org_id,
                url,
                email: userEmail,
                api_key: key,
                realm_name: result.data.realm_name,
                realm_icon: result.data.realm_icon,
            });
            if (props.onLoginWithEmail) {
                props.onLoginWithEmail(result.data, userEmail);
            }
            else {
                props.onLogin(result.data);
            }
        }
        catch (e) {
            setError(e?.toString() || "Login failed");
        }
        finally {
            setLoading(false);
        }
    };
    const handleCreateOrg = () => {
        platform.openLink("https://zulip.com/new/");
    };
    return (<div class="h-full flex items-center justify-center bg-[var(--background-base)]" data-component="login-view">
      {/* Title bar drag area (macOS) */}
      <div data-tauri-drag-region class="fixed top-0 left-0 right-0" style={{ height: "52px" }}/>

      <div class="w-full max-w-md mx-auto p-8">
        {/* Logo */}
        <div class="text-center mb-8">
          <h1 class="text-2xl font-bold text-[var(--text-primary)]">Foundry</h1>
          <p class="text-sm text-[var(--text-secondary)] mt-1">
            Connect to your Foundry organization
          </p>
        </div>

        <Show when={step() === "auth"} fallback={
        /* Step 1: Server URL */
        <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  Organization URL
                </label>
                <input data-component="server-url-input" class="setting-input-value w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--interactive-primary)] transition-colors" type="url" placeholder="https://your-org.foundry.dev" value={serverUrl()} onInput={(e) => setServerUrl(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && handleConnect()} autofocus/>
              </div>

              <Show when={error()}>
                <p class="text-sm text-[var(--status-error)]">{error()}</p>
              </Show>

              <button data-component="connect-button" id="connect" class="w-full py-2 px-4 rounded-[var(--radius-md)] bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] text-sm font-medium hover:bg-[var(--interactive-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleConnect} disabled={loading()}>
                {loading() ? "Connecting..." : "Connect"}
              </button>

              <div class="text-center">
                <a data-component="create-org-link" id="open-create-org-link" class="text-sm text-[var(--interactive-primary)] hover:underline cursor-pointer" onClick={handleCreateOrg}>
                  Create a new organization
                </a>
              </div>
            </div>}>
          {/* Step 2: Auth form */}
          <div class="space-y-4" data-component="auth-form">
            <div class="text-center mb-4">
              <p class="text-sm text-[var(--text-secondary)]">
                Connecting to <strong>{serverName()}</strong>
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-[var(--text-primary)] mb-1">
                Email
              </label>
              <input class="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--interactive-primary)] transition-colors" type="email" id="id_username" placeholder="you@example.com" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} autofocus/>
            </div>

            <div>
              <label class="block text-sm font-medium text-[var(--text-primary)] mb-1">
                API Key
              </label>
              <input class="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--interactive-primary)] transition-colors" type="password" placeholder="Your Zulip API key" value={apiKey()} onInput={(e) => setApiKey(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()}/>
              <p class="text-xs text-[var(--text-tertiary)] mt-1">
                Find your API key in Settings &rarr; Your Account &rarr; API Key
              </p>
            </div>

            <Show when={error()}>
              <p class="text-sm text-[var(--status-error)]">{error()}</p>
            </Show>

            <button class="w-full py-2 px-4 rounded-[var(--radius-md)] bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] text-sm font-medium hover:bg-[var(--interactive-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleLogin} disabled={loading()}>
              {loading() ? "Signing in..." : "Sign In"}
            </button>

            <button class="w-full py-2 px-4 rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)] text-sm hover:bg-[var(--background-surface)] transition-colors" onClick={() => {
            setStep("server");
            setError("");
        }}>
              Back
            </button>
          </div>
        </Show>
      </div>
    </div>);
}
