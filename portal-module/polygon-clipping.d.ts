// Minimale Typdeklaration fuer polygon-clipping (liefert keine eigenen Typen).
declare module "polygon-clipping" {
  type Pos = [number, number];
  type Ring = Pos[];
  type Polygon = Ring[];
  type MultiPolygon = Polygon[];
  type Geom = Polygon | MultiPolygon;
  const pc: {
    union(geom: Geom, ...geoms: Geom[]): MultiPolygon;
    intersection(geom: Geom, ...geoms: Geom[]): MultiPolygon;
    difference(geom: Geom, ...geoms: Geom[]): MultiPolygon;
    xor(geom: Geom, ...geoms: Geom[]): MultiPolygon;
  };
  export default pc;
}
