import { createContext, useContext, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

export interface OrgInfo {
  orgId: string
  realmName: string
  realmIcon: string
  realmUrl: string
  zulipFeatureLevel: number
  maxFileUploadSizeMib: number | null
  videoChatProvider: number | null
  realmJitsiServerUrl: string | null
  serverJitsiServerUrl: string | null
  giphyApiKey: string
  tenorApiKey: string
  gifRatingPolicy: number | null
}

interface OrgContextValue {
  orgId: string
  realmName: string
  realmIcon: string
  realmUrl: string
  zulipFeatureLevel: number
  maxFileUploadSizeMib: number | null
  videoChatProvider: number | null
  realmJitsiServerUrl: string | null
  serverJitsiServerUrl: string | null
  giphyApiKey: string
  tenorApiKey: string
  gifRatingPolicy: number | null
  setRealmName: (name: string) => void
  setRealmIcon: (icon: string) => void
  setRealmUrl: (url: string) => void
  setMaxFileUploadSizeMib: (value: number | null) => void
}

const OrgContext = createContext<OrgContextValue>()

export function OrgProvider(props: { org: OrgInfo; children: JSX.Element }) {
  const [store, setStore] = createStore<OrgInfo>({
    orgId: props.org.orgId,
    realmName: props.org.realmName,
    realmIcon: props.org.realmIcon,
    realmUrl: props.org.realmUrl,
    zulipFeatureLevel: props.org.zulipFeatureLevel,
    maxFileUploadSizeMib: props.org.maxFileUploadSizeMib,
    videoChatProvider: props.org.videoChatProvider,
    realmJitsiServerUrl: props.org.realmJitsiServerUrl,
    serverJitsiServerUrl: props.org.serverJitsiServerUrl,
    giphyApiKey: props.org.giphyApiKey,
    tenorApiKey: props.org.tenorApiKey,
    gifRatingPolicy: props.org.gifRatingPolicy,
  })

  const value: OrgContextValue = {
    get orgId() { return store.orgId },
    get realmName() { return store.realmName },
    get realmIcon() { return store.realmIcon },
    get realmUrl() { return store.realmUrl },
    get zulipFeatureLevel() { return store.zulipFeatureLevel },
    get maxFileUploadSizeMib() { return store.maxFileUploadSizeMib },
    get videoChatProvider() { return store.videoChatProvider },
    get realmJitsiServerUrl() { return store.realmJitsiServerUrl },
    get serverJitsiServerUrl() { return store.serverJitsiServerUrl },
    get giphyApiKey() { return store.giphyApiKey },
    get tenorApiKey() { return store.tenorApiKey },
    get gifRatingPolicy() { return store.gifRatingPolicy },
    setRealmName: (name: string) => setStore("realmName", name),
    setRealmIcon: (icon: string) => setStore("realmIcon", icon),
    setRealmUrl: (url: string) => setStore("realmUrl", url),
    setMaxFileUploadSizeMib: (value: number | null) => setStore("maxFileUploadSizeMib", value),
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
