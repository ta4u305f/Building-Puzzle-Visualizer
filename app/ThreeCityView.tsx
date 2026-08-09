"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { CityRenderer } from "@/lib/three-city/renderer";
import type {
  CityViewCommand,
  Viewpoint,
} from "@/lib/three-city/types";

export type ThreeCityViewHandle = {
  setView: (command: CityViewCommand) => void;
};

type ThreeCityViewProps = {
  grid: number[][];
  heightHues: readonly number[];
  size: number;
  viewpoint: Viewpoint;
};

const ThreeCityView = forwardRef<ThreeCityViewHandle, ThreeCityViewProps>(
  function ThreeCityView({ grid, heightHues, size, viewpoint }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fallbackRef = useRef<HTMLParagraphElement>(null);
    const rendererRef = useRef<CityRenderer | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        setView(command) {
          rendererRef.current?.setView(command);
        },
      }),
      [],
    );

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      try {
        rendererRef.current = new CityRenderer(canvas, container);
        if (fallbackRef.current) fallbackRef.current.hidden = true;
      } catch {
        if (fallbackRef.current) fallbackRef.current.hidden = false;
      }

      return () => {
        rendererRef.current?.dispose();
        rendererRef.current = null;
      };
    }, []);

    useEffect(() => {
      rendererRef.current?.setData(grid, size, heightHues);
    }, [grid, heightHues, size]);

    useEffect(() => {
      rendererRef.current?.setViewpoint(viewpoint);
    }, [viewpoint]);

    return (
      <div className="three-city-layer" ref={containerRef}>
        <canvas className="three-city-canvas" ref={canvasRef} aria-hidden="true" />
        <p className="three-city-fallback" ref={fallbackRef} hidden>
          このブラウザでは3D表示を利用できません。
        </p>
        <div className="three-city-a11y">
          {grid.flatMap((row, rowIndex) =>
            row.map((height, colIndex) =>
              height > 0 ? (
                <span
                  role="img"
                  aria-label={`高さ ${height} の直方体`}
                  key={`tower-description-${rowIndex}-${colIndex}`}
                />
              ) : null,
            ),
          )}
        </div>
      </div>
    );
  },
);

export default ThreeCityView;
