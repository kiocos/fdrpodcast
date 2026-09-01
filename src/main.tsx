import { inject } from '@vercel/analytics';
import { render } from 'solid-js/web';
import App from './App';
import './styles.css';

inject();

render(() => <App />, document.getElementById('root')!);
