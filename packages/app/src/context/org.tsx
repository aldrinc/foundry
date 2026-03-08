import { createContext, useContext, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

export interface OrgInfo {
  orgId: string
  realmName: string
  realmIcon: string
}

interface OrgContextValue {
  orgId: string
  realmName: string
  realmIcon: string
  setRealmName: (name: string) => void
  setRealmIcon: (icon: string) => void
}

const OrgContext = createContext<OrgContextValue>()

export function OrgProvider(props: { org: OrgInfo; children: JSX.Element }) {
  const [store, setStore] = createStore<OrgInfo>({
    orgId: props.org.orgId,
    realmName: props.org.realmName,
    realmIcon: props.org.realmIcon,
  })

  const value: OrgContextValue = {
    get orgId() { return store.orgId },
    get realmName() { return store.realmName },
    get realmIcon() { return store.realmIcon },
    setRealmName: (name: string) => setStore("realmName", name),
    setRealmIcon: (icon: string) => setStore("realmIcon", icon),
  }

  return (
    <OrgContext.Provider value={value}>
      {props.children}
    </OrgContext.Provider>
  )
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error("useOrg must be used within OrgProvider")
  return ctx
}
