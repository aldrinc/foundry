import { createContext, type JSX, useContext } from "solid-js";

export interface OrgInfo {
  orgId: string;
  realmName: string;
  realmIcon: string;
}

const OrgContext = createContext<OrgInfo>();

export function OrgProvider(props: { org: OrgInfo; children: JSX.Element }) {
  return (
    <OrgContext.Provider value={props.org}>
      {props.children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgInfo {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}
