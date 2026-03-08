import { type JSX } from "solid-js";
export interface OrgInfo {
    orgId: string;
    realmName: string;
    realmIcon: string;
}
export declare function OrgProvider(props: {
    org: OrgInfo;
    children: JSX.Element;
}): JSX.Element;
export declare function useOrg(): OrgInfo;
//# sourceMappingURL=org.d.ts.map