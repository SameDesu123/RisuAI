/**
 * Svelte `use:` action that defers `background-image` CSS loading
 * until the element is near the viewport, using IntersectionObserver.
 *
 * Usage:
 *   <div use:lazyBackground={backgroundCssString} style={sizeOnlyStyles}></div>
 *
 * The action splits the provided CSS string into background-related and
 * non-background parts. Size/layout styles apply immediately to preserve
 * layout, while background-image is deferred until visible.
 */
export function lazyBackground(node: HTMLElement, cssString: string) {
    let loaded = false
    let pendingCss = cssString ?? ''

    function applyBackground() {
        if (!pendingCss) return
        // Append the background CSS to the existing inline style
        node.style.cssText += pendingCss
        loaded = true
    }

    const observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting) {
                applyBackground()
                observer.disconnect()
            }
        },
        {
            rootMargin: '300px 0px',
            threshold: 0,
        }
    )

    observer.observe(node)

    return {
        update(newCss: string) {
            pendingCss = newCss ?? ''
            if (loaded) {
                // Already visible, apply immediately
                node.style.cssText += pendingCss
            }
        },
        destroy() {
            observer.disconnect()
        },
    }
}
