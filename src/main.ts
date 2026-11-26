import './style.css';
import { GameEngine } from '@core/GameEngine';
import { SplashScreen } from '@ui/SplashScreen';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('forest-canvas') as HTMLCanvasElement | null;
  const hudRoot = document.getElementById('hud-root');
  const splash = new SplashScreen();

  if (!canvas || !hudRoot) {
    throw new Error('Required #forest-canvas or #hud-root DOM container missing.');
  }

  try {
    const engine = await GameEngine.create(canvas, hudRoot, splash);
    engine.start();
    await splash.dismiss(280);

    // Clean up on hot module reload during development
    if (import.meta.hot) {
      import.meta.hot.dispose(() => engine.dispose());
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    splash.setProgress(100, `Could not open the realm: ${msg}`);
    throw err;
  }
}

void bootstrap();
