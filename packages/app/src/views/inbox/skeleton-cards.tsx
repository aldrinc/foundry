export function PriorityRowSkeleton() {
  return (
    <div class="flex items-center gap-3 px-3 py-2">
      <div class="w-1.5 h-1.5 rounded-full bg-[var(--background-elevated)] animate-pulse shrink-0" />
      <div class="flex-1 h-4 rounded bg-[var(--background-elevated)] animate-pulse" />
      <div class="w-10 h-3 rounded bg-[var(--background-elevated)] animate-pulse shrink-0" />
    </div>
  )
}

export function PrioritySectionSkeleton() {
  return (
    <div class="flex flex-col">
      <div class="px-3 pt-2 pb-1">
        <div class="w-24 h-3 rounded bg-[var(--background-elevated)] animate-pulse" />
      </div>
      <PriorityRowSkeleton />
      <PriorityRowSkeleton />
      <PriorityRowSkeleton />
      <PriorityRowSkeleton />
    </div>
  )
}

export function UnclearSectionSkeleton() {
  return (
    <div class="flex flex-col">
      <div class="px-3 pt-3 pb-1">
        <div class="w-16 h-3 rounded bg-[var(--background-elevated)] animate-pulse" />
      </div>
      <PriorityRowSkeleton />
    </div>
  )
}
