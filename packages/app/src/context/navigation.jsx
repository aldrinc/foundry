import { createContext, useContext } from "solid-js";
import { createSignal } from "solid-js";
import { isSpecialNarrow, narrowToFilters, parseNarrow, } from "./navigation-utils";
const NavContext = createContext();
export function NavigationProvider(props) {
    const [activeNarrow, setActiveNarrow] = createSignal(null);
    const nav = {
        activeNarrow,
        setActiveNarrow,
        narrowToFilters,
        parseNarrow,
        isSpecialNarrow,
    };
    return (<NavContext.Provider value={nav}>
      {props.children}
    </NavContext.Provider>);
}
export function useNavigation() {
    const ctx = useContext(NavContext);
    if (!ctx)
        throw new Error("useNavigation must be used within NavigationProvider");
    return ctx;
}
