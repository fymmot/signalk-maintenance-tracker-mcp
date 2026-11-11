import { render } from 'preact'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/layout.css'
import { App } from './app'

render(<App />, document.getElementById('app')!)
