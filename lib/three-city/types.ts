export type Direction = "north" | "east" | "south" | "west";

export type ClueViewpoint = {
  direction: Direction;
  index: number;
};

export type Viewpoint = ClueViewpoint | null;

export type CameraAngles = {
  tilt: number;
  rotation: number;
};

export type CityViewCommand =
  | {
      mode: "overview";
      animate?: boolean;
    }
  | {
      mode: "clue";
      direction: Direction;
      index: number;
      animate?: boolean;
    }
  | {
      mode: "free";
      camera: CameraAngles;
      animate?: boolean;
    };

export type Cell = {
  col: number;
  height: number;
  row: number;
};

export type ProjectionMode = "orthographic" | "perspective";
