import { Show } from "solid-js";
import { useSettings } from "../context/settings";
import { SettingToggle } from "./settings-general";
export function SettingsNetwork() {
    const { store, setSetting } = useSettings();
    return (<div class="space-y-6">
      <h3 class="text-sm font-semibold text-[var(--text-primary)]">Network</h3>

      <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Proxy settings</div>

      <SettingToggle label="Use system proxy settings" description="Follow your operating system's proxy configuration (requires restart)" checked={store.useSystemProxy} onChange={(v) => {
            setSetting("useSystemProxy", v);
            if (v)
                setSetting("manualProxy", false);
        }}/>

      <SettingToggle label="Manual proxy configuration" description="Manually configure proxy server settings" checked={store.manualProxy} onChange={(v) => {
            setSetting("manualProxy", v);
            if (v)
                setSetting("useSystemProxy", false);
        }}/>

      <Show when={store.manualProxy}>
        <div class="space-y-4 pl-4 border-l-2 border-[var(--border-default)]">
          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">PAC script URL</label>
            <input type="text" class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] font-mono" placeholder="https://example.com/proxy.pac" value={store.pacUrl} onInput={(e) => setSetting("pacUrl", e.currentTarget.value)}/>
          </div>

          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Proxy rules</label>
            <input type="text" class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] font-mono" placeholder="http=proxy:8080;https=proxy:8443" value={store.proxyRules} onInput={(e) => setSetting("proxyRules", e.currentTarget.value)}/>
            <div class="text-[10px] text-[var(--text-tertiary)] mt-1">
              Proxy rules in Chromium format
            </div>
          </div>

          <div>
            <label class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider block mb-1">Proxy bypass rules</label>
            <input type="text" class="w-full text-xs bg-[var(--background-base)] border border-[var(--border-default)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] font-mono" placeholder="localhost,127.0.0.1,*.local" value={store.bypassRules} onInput={(e) => setSetting("bypassRules", e.currentTarget.value)}/>
            <div class="text-[10px] text-[var(--text-tertiary)] mt-1">
              Comma-separated list of hosts/domains that bypass the proxy
            </div>
          </div>
        </div>
      </Show>

      <hr class="border-[var(--border-default)]"/>

      <div class="p-3 bg-[var(--background-base)] rounded-[var(--radius-md)] border border-[var(--border-default)]">
        <div class="text-xs text-[var(--text-secondary)]">
          Changes to proxy settings require restarting the application to take effect.
        </div>
      </div>
    </div>);
}
