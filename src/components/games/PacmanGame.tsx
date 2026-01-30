import { useEffect, useRef, useState, useCallback } from 'react';

const CELL_SIZE = 15;
const GRID_WIDTH = 20;
const GRID_HEIGHT = 20;
const CANVAS_WIDTH = CELL_SIZE * GRID_WIDTH;
const CANVAS_HEIGHT = CELL_SIZE * GRID_HEIGHT;

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
type Point = { x: number; y: number };

// Simple maze layout (1 = wall, 0 = path)
const MAZE = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,0,1,1,1,0,1,1,0,1,1,1,0,1,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,0,1,0,1,1,1,1,1,1,0,1,0,1,1,0,1],
  [1,0,0,0,0,1,0,0,0,1,1,0,0,0,1,0,0,0,0,1],
  [1,1,1,1,0,1,1,1,0,1,1,0,1,1,1,0,1,1,1,1],
  [1,1,1,1,0,1,0,0,0,0,0,0,0,0,1,0,1,1,1,1],
  [1,1,1,1,0,1,0,1,1,0,0,1,1,0,1,0,1,1,1,1],
  [0,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0],
  [1,1,1,1,0,1,0,1,1,1,1,1,1,0,1,0,1,1,1,1],
  [1,1,1,1,0,1,0,0,0,0,0,0,0,0,1,0,1,1,1,1],
  [1,1,1,1,0,1,0,1,1,1,1,1,1,0,1,0,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,0,1,1,1,0,1,1,0,1,1,1,0,1,1,0,1],
  [1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,1],
  [1,1,0,1,0,1,0,1,1,1,1,1,1,0,1,0,1,0,1,1],
  [1,0,0,0,0,1,0,0,0,1,1,0,0,0,1,0,0,0,0,1],
  [1,0,1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

interface Ghost {
  pos: Point;
  dir: Direction;
  color: string;
  name: string;
}

const GHOST_COLORS = ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852']; // Blinky, Pinky, Inky, Clyde
const GHOST_STARTS: Point[] = [
  { x: 9, y: 8 }, { x: 10, y: 8 }, { x: 9, y: 9 }, { x: 10, y: 9 }
];

export function PacmanGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pacman, setPacman] = useState<Point>({ x: 1, y: 1 });
  const [direction, setDirection] = useState<Direction>('RIGHT');
  const [dots, setDots] = useState<Point[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [mouthOpen, setMouthOpen] = useState(true);
  const directionRef = useRef(direction);
  const pacmanRef = useRef(pacman);
  pacmanRef.current = pacman;

  // Initialize dots
  const initDots = useCallback(() => {
    const newDots: Point[] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (MAZE[y][x] === 0) {
          newDots.push({ x, y });
        }
      }
    }
    return newDots;
  }, []);

  const initGhosts = useCallback((): Ghost[] => {
    return GHOST_STARTS.map((pos, i) => ({
      pos: { ...pos },
      dir: (['UP', 'DOWN', 'LEFT', 'RIGHT'] as Direction[])[i % 4],
      color: GHOST_COLORS[i],
      name: ['Blinky', 'Pinky', 'Inky', 'Clyde'][i],
    }));
  }, []);

  const resetGame = useCallback(() => {
    setPacman({ x: 1, y: 1 });
    setDirection('RIGHT');
    directionRef.current = 'RIGHT';
    setDots(initDots());
    setGhosts(initGhosts());
    setScore(0);
    setLives(3);
    setGameOver(false);
    setIsPaused(false);
  }, [initDots, initGhosts]);

  // Initialize on mount
  useEffect(() => {
    setDots(initDots());
    setGhosts(initGhosts());
  }, [initDots, initGhosts]);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameOver) return;
      
      const key = e.key;
      
      if (key === 'ArrowUp') {
        setDirection('UP');
        directionRef.current = 'UP';
        if (isPaused) setIsPaused(false);
      } else if (key === 'ArrowDown') {
        setDirection('DOWN');
        directionRef.current = 'DOWN';
        if (isPaused) setIsPaused(false);
      } else if (key === 'ArrowLeft') {
        setDirection('LEFT');
        directionRef.current = 'LEFT';
        if (isPaused) setIsPaused(false);
      } else if (key === 'ArrowRight') {
        setDirection('RIGHT');
        directionRef.current = 'RIGHT';
        if (isPaused) setIsPaused(false);
      } else if (key === ' ') {
        e.preventDefault();
        if (gameOver) {
          resetGame();
        } else {
          setIsPaused(p => !p);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameOver, isPaused, resetGame]);

  // Game loop
  useEffect(() => {
    if (isPaused || gameOver) return;

    const movePacman = () => {
      setPacman(prev => {
        const newPos = { ...prev };
        const dir = directionRef.current;

        switch (dir) {
          case 'UP': newPos.y -= 1; break;
          case 'DOWN': newPos.y += 1; break;
          case 'LEFT': newPos.x -= 1; break;
          case 'RIGHT': newPos.x += 1; break;
        }

        // Wrap around
        if (newPos.x < 0) newPos.x = GRID_WIDTH - 1;
        if (newPos.x >= GRID_WIDTH) newPos.x = 0;
        if (newPos.y < 0) newPos.y = GRID_HEIGHT - 1;
        if (newPos.y >= GRID_HEIGHT) newPos.y = 0;

        // Check wall collision
        if (MAZE[newPos.y]?.[newPos.x] === 1) {
          return prev;
        }

        return newPos;
      });

      setMouthOpen(m => !m);
      
      // Move ghosts
      setGhosts(prevGhosts => prevGhosts.map(ghost => {
        const pac = pacmanRef.current;
        const dirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
        const deltas: Record<Direction, Point> = {
          'UP': { x: 0, y: -1 }, 'DOWN': { x: 0, y: 1 },
          'LEFT': { x: -1, y: 0 }, 'RIGHT': { x: 1, y: 0 },
        };
        const opposite: Record<Direction, Direction> = {
          'UP': 'DOWN', 'DOWN': 'UP', 'LEFT': 'RIGHT', 'RIGHT': 'LEFT',
        };
        
        // Get valid moves (not wall, not reverse unless no choice)
        const validDirs = dirs.filter(d => {
          const nx = ghost.pos.x + deltas[d].x;
          const ny = ghost.pos.y + deltas[d].y;
          if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT) return false;
          return MAZE[ny]?.[nx] === 0;
        });
        
        if (validDirs.length === 0) return ghost;
        
        // Prefer not reversing
        const nonReverse = validDirs.filter(d => d !== opposite[ghost.dir]);
        const choices = nonReverse.length > 0 ? nonReverse : validDirs;
        
        // 70% chance to chase Pacman, 30% random
        let bestDir: Direction;
        if (Math.random() < 0.7) {
          // Chase: pick direction that gets closest to Pacman
          bestDir = choices.reduce((best, d) => {
            const nx = ghost.pos.x + deltas[d].x;
            const ny = ghost.pos.y + deltas[d].y;
            const bx = ghost.pos.x + deltas[best].x;
            const by = ghost.pos.y + deltas[best].y;
            const distNew = Math.abs(nx - pac.x) + Math.abs(ny - pac.y);
            const distBest = Math.abs(bx - pac.x) + Math.abs(by - pac.y);
            return distNew < distBest ? d : best;
          });
        } else {
          bestDir = choices[Math.floor(Math.random() * choices.length)];
        }
        
        const newPos = {
          x: ghost.pos.x + deltas[bestDir].x,
          y: ghost.pos.y + deltas[bestDir].y,
        };
        
        return { ...ghost, pos: newPos, dir: bestDir };
      }));
    };

    const interval = setInterval(movePacman, 150);
    return () => clearInterval(interval);
  }, [isPaused, gameOver]);

  // Check dot collection and ghost collision
  useEffect(() => {
    const dotIndex = dots.findIndex(d => d.x === pacman.x && d.y === pacman.y);
    if (dotIndex !== -1) {
      setDots(prev => prev.filter((_, i) => i !== dotIndex));
      setScore(s => s + 10);
    }
    
    // Ghost collision
    const hitGhost = ghosts.some(g => g.pos.x === pacman.x && g.pos.y === pacman.y);
    if (hitGhost) {
      setLives(l => {
        const newLives = l - 1;
        if (newLives <= 0) {
          setGameOver(true);
        } else {
          // Reset positions
          setPacman({ x: 1, y: 1 });
          directionRef.current = 'RIGHT';
          setGhosts(initGhosts());
        }
        return newLives;
      });
    }
    
    if (dots.length === 0 && score > 0) {
      setGameOver(true);
    }
  }, [pacman, dots, ghosts, score, initGhosts]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw maze
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (MAZE[y][x] === 1) {
          ctx.fillStyle = '#1e3a5f';
          ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }

    // Draw dots
    ctx.fillStyle = '#fbbf24';
    dots.forEach(dot => {
      ctx.beginPath();
      ctx.arc(
        dot.x * CELL_SIZE + CELL_SIZE / 2,
        dot.y * CELL_SIZE + CELL_SIZE / 2,
        2,
        0,
        Math.PI * 2
      );
      ctx.fill();
    });

    // Draw ghosts
    ghosts.forEach(ghost => {
      const gx = ghost.pos.x * CELL_SIZE + CELL_SIZE / 2;
      const gy = ghost.pos.y * CELL_SIZE + CELL_SIZE / 2;
      const gr = CELL_SIZE / 2 - 1;
      
      ctx.fillStyle = ghost.color;
      ctx.shadowColor = ghost.color;
      ctx.shadowBlur = 6;
      
      // Ghost body (rounded top, wavy bottom)
      ctx.beginPath();
      ctx.arc(gx, gy - 1, gr, Math.PI, 0);
      ctx.lineTo(gx + gr, gy + gr);
      // Wavy bottom
      const waveW = gr / 1.5;
      ctx.lineTo(gx + gr - waveW / 2, gy + gr - 2);
      ctx.lineTo(gx + gr - waveW, gy + gr);
      ctx.lineTo(gx, gy + gr - 2);
      ctx.lineTo(gx - gr + waveW, gy + gr);
      ctx.lineTo(gx - gr + waveW / 2, gy + gr - 2);
      ctx.lineTo(gx - gr, gy + gr);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      
      // Eyes
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(gx - 2, gy - 2, 2.5, 0, Math.PI * 2);
      ctx.arc(gx + 3, gy - 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0000ff';
      ctx.beginPath();
      ctx.arc(gx - 1.5, gy - 2, 1.2, 0, Math.PI * 2);
      ctx.arc(gx + 3.5, gy - 2, 1.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Pacman
    ctx.fillStyle = '#facc15';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    
    const centerX = pacman.x * CELL_SIZE + CELL_SIZE / 2;
    const centerY = pacman.y * CELL_SIZE + CELL_SIZE / 2;
    const radius = CELL_SIZE / 2 - 1;
    
    if (mouthOpen) {
      let startAngle = 0.2;
      let endAngle = Math.PI * 2 - 0.2;
      
      switch (directionRef.current) {
        case 'RIGHT': startAngle = 0.2; endAngle = Math.PI * 2 - 0.2; break;
        case 'LEFT': startAngle = Math.PI + 0.2; endAngle = Math.PI - 0.2; break;
        case 'UP': startAngle = Math.PI * 1.5 + 0.2; endAngle = Math.PI * 1.5 - 0.2; break;
        case 'DOWN': startAngle = Math.PI * 0.5 + 0.2; endAngle = Math.PI * 0.5 - 0.2; break;
      }
      
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.lineTo(centerX, centerY);
    } else {
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    }
    
    ctx.fill();
    ctx.shadowBlur = 0;

    // Draw game over or paused overlay
    if (gameOver || isPaused) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      if (gameOver) {
        const didWin = dots.length === 0;
        ctx.fillStyle = didWin ? '#22c55e' : '#ef4444';
        ctx.fillText(didWin ? 'YOU WIN!' : 'GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        ctx.fillText('Press SPACE to restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 15);
      } else {
        ctx.fillText('PAUSED', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10);
        ctx.font = '12px monospace';
        ctx.fillText('Arrow keys to start', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 15);
      }
    }
  }, [pacman, dots, ghosts, gameOver, isPaused, mouthOpen, lives]);

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="border border-white/10 rounded-lg"
      />
      <div className="flex items-center justify-between w-full px-2">
        <span className="text-xs text-[#facc15] font-mono">Score: {score}</span>
        <span className="text-xs text-[#ef4444] font-mono">Lives: {lives}</span>
      </div>
    </div>
  );
}
