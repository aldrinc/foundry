import { createSignal, createEffect, type JSX } from "solid-js"

/**
 * AnimatedShow — a wrapper around SolidJS conditional rendering that supports
 * CSS enter/exit animations. When `when` becomes true, the children mount with
 * `enterClass`. When `when` becomes false, `exitClass` is applied and the
 * children remain mounted until the animation finishes (onanimationend).
 */
export function AnimatedShow(props: {
  when: boolean
  enterClass?: string
  exitClass?: string
  children: JSX.Element
}) {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  const [mounted, setMounted] = createSignal(props.when)
  const [animClass, setAnimClass] = createSignal(props.when ? (props.enterClass ?? "") : "")

  createEffect(() => {
    if (props.when) {
      setMounted(true)
      setAnimClass(props.enterClass ?? "")
    } else if (mounted()) {
      if (prefersReducedMotion || !props.exitClass) {
        setMounted(false)
        setAnimClass("")
      } else {
        setAnimClass(props.exitClass)
      }
    }
  })

  const handleAnimationEnd = () => {
    if (!props.when) {
      setMounted(false)
      setAnimClass("")
    }
  }

  return (
    <>
      {mounted() && (
        <div class={animClass()} onAnimationEnd={handleAnimationEnd}>
          {props.children}
        </div>
      )}
    </>
  )
}
