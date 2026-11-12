import { defineComponent, h, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import './custom.css'

let mermaidId = 0

const MermaidDiagram = defineComponent({
  name: 'MermaidDiagram',
  props: {
    code: { type: String, required: true },
  },
  setup(props) {
    const { isDark } = useData()
    const svg = ref('')

    async function renderDiagram() {
      const mermaid = (await import('mermaid')).default
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark.value ? 'dark' : 'default',
        fontFamily: 'Outfit, ui-sans-serif, system-ui, sans-serif',
      })
      const id = `vp-mermaid-${++mermaidId}`
      const { svg: rendered } = await mermaid.render(id, decodeURIComponent(props.code))
      svg.value = rendered
    }

    onMounted(renderDiagram)
    watch(isDark, renderDiagram)

    return () =>
      h('div', {
        class: 'mermaid-diagram',
        innerHTML: svg.value,
      })
  },
})

export default {
  extends: DefaultTheme,
  enhanceApp({ app }: { app: { component: (name: string, comp: unknown) => void } }) {
    app.component('MermaidDiagram', MermaidDiagram)
  },
}
