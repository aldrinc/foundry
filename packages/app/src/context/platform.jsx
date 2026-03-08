import { createContext, useContext } from "solid-js";
const PlatformContext = createContext();
export function PlatformProvider(props) {
    return (<PlatformContext.Provider value={props.value}>
      {props.children}
    </PlatformContext.Provider>);
}
export function usePlatform() {
    const ctx = useContext(PlatformContext);
    if (!ctx)
        throw new Error("usePlatform must be used within PlatformProvider");
    return ctx;
}
