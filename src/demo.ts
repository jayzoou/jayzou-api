import { artifactSchema } from './contracts.js'

export const debounceDemo = artifactSchema.parse({
  id: 'debounce', title: '防抖搜索组件', simulated: true,
  files: {
    '/App.tsx': `import { useEffect, useState } from 'react';
import './styles.css';

export default function App() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), 500);
    return () => clearTimeout(timer);
  }, [input]);
  return <main><h1>防抖搜索</h1>
    <label>输入关键词<input value={input} onChange={e => setInput(e.target.value)} /></label>
    <p>当前输入：{input || '—'}</p><p>500ms 后查询：{query || '—'}</p>
  </main>;
}
`,
    '/styles.css': 'body { background: #111827; color: #e5e7eb; font-family: system-ui; padding: 24px; } input { display: block; padding: 12px; margin-top: 8px; border-radius: 8px; }',
  },
})
