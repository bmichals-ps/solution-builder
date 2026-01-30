import { useEffect, useRef, useState, useCallback } from 'react';

const CELL_SIZE = 15;
const GRID_SIZE = 20;
const CANVAS_SIZE = CELL_SIZE * GRID_SIZE;

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
type Point = { x: number; y: number };

export function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snake, setSnake] = useState<Point[]>([{ x: 10, y: 10 }]);
  const [food, setFood] = useState<Point>({ x: 15, y: 10 });
  const [direction, setDirection] = useState<Direction>('RIGHT');
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const directionRef = useRef(direction);

  const generateFood = useCallback((currentSnake: Point[]): Point => {
    let newFood: Point;
    do {
      newFood = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE),
      };
    } while (currentSnake.some(seg => seg.x === newFood.x && seg.y === newFood.y));
    return newFood;
  }, []);

  const resetGame = useCallback(() => {
    const initialSnake = [{ x: 10, y: 10 }];
    setSnake(initialSnake);
    setFood(generateFood(initialSnake));
    setDirection('RIGHT');
    directionRef.current = 'RIGHT';
    setGameOver(false);
    setScore(0);
    setIsPaused(false);
  }, [generateFood]);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameOver) return;
      
      const key = e.key;
      const currentDir = directionRef.current;
      
      if (key === 'ArrowUp' && currentDir !== 'DOWN') {
        setDirection('UP');
        directionRef.current = 'UP';
        if (isPaused) setIsPaused(false);
      } else if (key === 'ArrowDown' && currentDir !== 'UP') {
        setDirection('DOWN');
        directionRef.current = 'DOWN';
        if (isPaused) setIsPaused(false);
      } else if (key === 'ArrowLeft' && currentDir !== 'RIGHT') {
        setDirection('LEFT');
        directionRef.current = 'LEFT';
        if (isPaused) setIsPaused(false);
      } else if (key === 'ArrowRight' && currentDir !== 'LEFT') {
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

    const moveSnake = () => {
      setSnake(prevSnake => {
        const head = { ...prevSnake[0] };
        const dir = directionRef.current;

        switch (dir) {
          case 'UP': head.y -= 1; break;
          case 'DOWN': head.y += 1; break;
          case 'LEFT': head.x -= 1; break;
          case 'RIGHT': head.x += 1; break;
        }

        // Wrap around screen edges
        if (head.x < 0) head.x = GRID_SIZE - 1;
        if (head.x >= GRID_SIZE) head.x = 0;
        if (head.y < 0) head.y = GRID_SIZE - 1;
        if (head.y >= GRID_SIZE) head.y = 0;

        // Check self collision
        if (prevSnake.some(seg => seg.x === head.x && seg.y === head.y)) {
          setGameOver(true);
          return prevSnake;
        }

        const newSnake = [head, ...prevSnake];

        // Check food collision
        if (head.x === food.x && head.y === food.y) {
          setScore(s => s + 10);
          setFood(generateFood(newSnake));
        } else {
          newSnake.pop();
        }

        return newSnake;
      });
    };

    const interval = setInterval(moveSnake, 120);
    return () => clearInterval(interval);
  }, [isPaused, gameOver, food, generateFood]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Draw grid (subtle)
    ctx.strokeStyle = '#1a1a25';
    for (let i = 0; i <= GRID_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL_SIZE, 0);
      ctx.lineTo(i * CELL_SIZE, CANVAS_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL_SIZE);
      ctx.lineTo(CANVAS_SIZE, i * CELL_SIZE);
      ctx.stroke();
    }

    // Draw food
    ctx.fillStyle = '#ef4444';
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 8;
    ctx.fillRect(
      food.x * CELL_SIZE + 2,
      food.y * CELL_SIZE + 2,
      CELL_SIZE - 4,
      CELL_SIZE - 4
    );
    ctx.shadowBlur = 0;

    // Draw snake
    snake.forEach((segment, index) => {
      const isHead = index === 0;
      ctx.fillStyle = isHead ? '#22c55e' : '#16a34a';
      if (isHead) {
        ctx.shadowColor = '#22c55e';
        ctx.shadowBlur = 6;
      }
      ctx.fillRect(
        segment.x * CELL_SIZE + 1,
        segment.y * CELL_SIZE + 1,
        CELL_SIZE - 2,
        CELL_SIZE - 2
      );
      ctx.shadowBlur = 0;
    });

    // Draw game over or paused overlay
    if (gameOver || isPaused) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      if (gameOver) {
        ctx.fillText('GAME OVER', CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 10);
        ctx.font = '12px monospace';
        ctx.fillText('Press SPACE to restart', CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 15);
      } else {
        ctx.fillText('PAUSED', CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 10);
        ctx.font = '12px monospace';
        ctx.fillText('Arrow keys to start', CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 15);
      }
    }
  }, [snake, food, gameOver, isPaused]);

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        className="border border-white/10 rounded-lg"
      />
      <div className="flex items-center justify-between w-full px-2">
        <span className="text-xs text-[#22c55e] font-mono">Score: {score}</span>
        <span className="text-xs text-[#6a6a75] font-mono">Use arrow keys</span>
      </div>
    </div>
  );
}
