export const versions: Version[] = [
  {
    frontVersion: "1.0.0",
    needUpdate: true,
  },
  {
    frontVersion: "1.0.1",
    needUpdate: true,
  },
  {
    frontVersion: "1.0.2",
    needUpdate: false,
  },
  {
    frontVersion: "1.0.3",
    needUpdate: false,
  },
];

export interface Version {
  frontVersion: string;
  needUpdate: boolean;
}
