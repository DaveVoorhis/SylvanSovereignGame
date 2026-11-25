import './style.css';
import { GameEngine } from '@core/GameEngine';

function bootstrap(): void {
  const canvas = document.getElementById('forest-canvas') as HTMLCanvasElement | null;
  const hudRoot = document.getElementById('hud-root');

  if (!canvas || !hudRoot) {
    throw new Error('Required #forest-canvas or #hud-root DOM container missing.');
  }

  const engine = new GameEngine(canvas, hudRoot);
  engine.start();

  // Clean up on hot module reload during development
  if (import.meta.hot) {
    import.meta.hot.dispose(() => engine.dispose());
  }
}

bootstrap();
