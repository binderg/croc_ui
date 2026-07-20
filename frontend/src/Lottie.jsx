import {useEffect, useRef} from 'react'
// lottie_light ships only the SVG renderer, which is all these shape-based
// animations need, and drops roughly half the bundle weight of the full build.
import lottie from 'lottie-web/build/player/lottie_light'

/**
 * Lottie renders a bodymovin animation and tears it down cleanly.
 *
 * Under prefers-reduced-motion it holds a single representative frame instead
 * of looping, so the illustration still reads without any movement.
 */
export default function Lottie({
    data,
    loop = true,
    autoplay = true,
    speed = 1,
    staticFrame = 0,
    className = '',
    style,
}) {
    const host = useRef(null)

    useEffect(() => {
        if (!host.current) return

        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

        const anim = lottie.loadAnimation({
            container: host.current,
            renderer: 'svg',
            loop: reduce ? false : loop,
            autoplay: reduce ? false : autoplay,
            animationData: data,
            rendererSettings: {
                preserveAspectRatio: 'xMidYMid meet',
                progressiveLoad: true,
            },
        })
        anim.setSpeed(speed)

        if (reduce) {
            anim.goToAndStop(staticFrame, true)
        }

        return () => anim.destroy()
    }, [data, loop, autoplay, speed, staticFrame])

    return <div ref={host} className={className} style={style} aria-hidden="true"/>
}
