import type { LoginResult } from "@zulip/desktop/bindings";
/**
 * Login view — server URL input + authentication form.
 */
export declare function LoginView(props: {
    onLogin: (result: LoginResult) => void;
    onLoginWithEmail?: (result: LoginResult, email: string) => void;
}): import("solid-js").JSX.Element;
//# sourceMappingURL=login.d.ts.map