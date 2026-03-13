export function sessionEngineLabel(session: any) {
  const engine = session?.metadata?.engine?.trim?.() || ""
  if (!engine) {
    return ""
  }

  const model = session?.metadata?.moltis_model?.trim?.() || ""
  if (engine.toLowerCase() === "moltis" && model) {
    return `${engine} · ${model}`
  }

  return engine
}

export function sessionSubtitle(session: any) {
  const createdVia = session?.metadata?.created_via?.trim?.() || ""
  const createdBy = session?.metadata?.created_by_name?.trim?.()
    || session?.metadata?.created_by_user_id?.trim?.()
    || ""
  const source = createdVia || sessionEngineLabel(session)
  return [source, createdBy].filter(Boolean).join(" · ") || "Supervisor session"
}
