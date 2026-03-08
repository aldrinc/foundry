import { createContext, useContext } from "solid-js";
const OrgContext = createContext();
export function OrgProvider(props) {
    return (<OrgContext.Provider value={props.org}>
      {props.children}
    </OrgContext.Provider>);
}
export function useOrg() {
    const ctx = useContext(OrgContext);
    if (!ctx)
        throw new Error("useOrg must be used within OrgProvider");
    return ctx;
}
