import { describe, expect, it } from "vitest";
import { analyzeOptics } from "./optics.js";
import { ftthScenario, lanScenario, xgsPonScenario } from "./scenarios.js";
import { opticalTree, type OpticalTreeNode } from "./tree.js";

/** Forme compacte d'un sous-arbre : « équipement[ports] > enfants ». */
const shape = (node: OpticalTreeNode): unknown => [`${node.deviceId}[${node.entryPorts.join(",")}]`, node.onts, ...node.children.map(shape)];

describe("arbre optique", () => {
  it("regroupe les chemins du réseau FTTH par équipement, de l'OLT aux ONT", () => {
    const [root, ...others] = opticalTree(analyzeOptics(ftthScenario()));
    expect(others).toEqual([]);
    expect(root?.olt).toEqual({ deviceId: "olt1", portId: "pon1" });
    expect(root?.onts).toEqual(["ont1", "ont2", "ont3"]);
    const odf = root?.children[0];
    expect(odf && shape(odf)).toEqual([
      "odf1[f1]",
      ["ont1", "ont2", "ont3"],
      [
        "cpl1[com]",
        ["ont1", "ont2", "ont3"],
        [
          "cpl2[com]",
          ["ont1", "ont2", "ont3"],
          [
            "pbo1[in1,in2,in3]",
            ["ont1", "ont2", "ont3"],
            ["pto1[in]", ["ont1"], ["ont1[pon]", ["ont1"]]],
            ["pto2[in]", ["ont2"], ["ont2[pon]", ["ont2"]]],
            ["pto3[in]", ["ont3"], ["ont3[pon]", ["ont3"]]],
          ],
        ],
      ],
    ]);
  });

  it("garde les ONT d'une autre technologie dans l'arbre (le chemin existe) et rien sans OLT", () => {
    const [root] = opticalTree(analyzeOptics(xgsPonScenario()));
    expect(root?.onts).toEqual(["ont1", "ont2", "ont3"]);
    expect(root?.children[0]?.children[0]?.children.map((node) => node.deviceId)).toEqual(["pto1", "pto2", "pto3"]);
    expect(opticalTree(analyzeOptics(lanScenario()))).toEqual([]);
  });
});
