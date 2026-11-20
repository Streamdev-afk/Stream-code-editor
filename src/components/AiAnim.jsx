import { useEffect, useRef } from 'react'
import lottie from 'lottie-web/build/player/lottie_light'
import thinking from '../assets/lottie/thinking.json'
import writing from '../assets/lottie/writing.json'
import running from '../assets/lottie/running.json'
import done from '../assets/lottie/done.json'

const DATA = { thinking, writing, running, done }

/** Small looping animations for what the AI is doing: thinking, writing, running, done. */
export default function AiAnim({ name = 'thinking', size = 40, loop = true }) {
  const box = useRef(null)
  useEffect(() => {
    if (!box.current) return undefined
    let anim
    try {
      anim = lottie.loadAnimation({
        container: box.current,
        renderer: 'svg',
        loop: name === 'done' ? false : loop,
        autoplay: true,
        animationData: DATA[name] || thinking,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
      })
    } catch { /* the animation is only decoration */ }
    return () => { try { anim?.destroy() } catch { /* ignore */ } }
  }, [name, loop])
  return <span className="ai-anim" ref={box} style={{ width: size, height: size }} aria-hidden="true" />
}
