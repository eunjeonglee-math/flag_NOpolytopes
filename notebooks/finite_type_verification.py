"""Reproducible finite-type cluster polytope computations in SageMath.

Only initial data enter the calculation. 
Coordinates are columns; H rows encode c + a*x >= 0. Frozen labels stay fixed.
"""
from collections import defaultdict
from pathlib import Path
import hashlib
import itertools
import json
import time

from sage.all import (QQ, ZZ, Graph, LatticePolytope, Polyhedron,
                      PolynomialRing, gcd, lcm, matrix, vector)
from sage.env import SAGE_VERSION


def save_json(path, data):
# Input: A destination file path and JSON-serializable data.
# Action: Save the data as JSON, creating parent directories if needed.
# Output: None.

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def exact(x):
# Input: A value convertible to a rational number.
# Output: A Python int if integral; otherwise a fraction string such as "1/3".

    q = QQ(x)
    return int(q) if q.denominator() == 1 else str(q)


def h_rows(P):
# Input: A polytope P.
# Output: A sorted list of primitive integer inequality rows.
# Each row [c, a1, ..., ad] represents c + a1*y1 + ... + ad*yd >= 0.    
    rows = []
    for row in P.inequalities_list():
        values = vector(QQ, row)
        values *= lcm([x.denominator() for x in values])
        values /= gcd([ZZ(x) for x in values])
        rows.append([int(x) for x in values])
    return sorted(rows)


def initial_data(kind):
# Input: "A4" or "B2".
# Output: A dictionary containing the initial word, exchange matrix,
# inequalities, dimension, mutable rank, symmetrizer, and expected seed count.

    if kind == "A4":
        n, d, r = 5, 10, 6
        B = [[0] * r for _ in range(d)]
        H, word = [], []
        index = lambda row, col: row * (row + 1) // 2 + col
        def arrow(a, b):
            if b < r:
                B[a][b] -= 1
            if a < r:
                B[b][a] += 1
        for row in range(n - 1):
            for col in range(row + 1):
                v = index(row, col)
                word.append(row - col + 1)
                plus, minus = [0] * d, [0] * d
                for lower in range(row, n - 1):
                    plus[index(lower, col)] = 1
                    minus[index(lower, col + lower - row)] = -1
                H.extend([[1] + plus, [1] + minus])
                if row < n - 2:
                    arrow(v, index(row + 1, col))
                    arrow(index(row + 1, col + 1), v)
                    if row + 1 < n - 2:
                        arrow(index(row + 1, col), index(row + 1, col + 1))
        return dict(kind=kind, dimension=d, rank=r, word=word, B=B, H=H,
                    expected_seeds=672, symmetrizer=[1]*r)
    if kind == "B2":
        # FO Example 6.33: C2 word 1212, hence B2 word 2121.
        # Here B=-epsilon^T; the minus sign matches the tropical convention below.
        epsilon = matrix(ZZ, [[0, -2, 1, 0], [1, 0, -1, 1]])
        B = [[int(x) for x in row] for row in (-epsilon.transpose()).rows()]
        H = [[0,0,0,0,1], [2,0,0,0,-1],
             [0,0,0,1,0], [2,0,0,-1,0],
             [0,0,1,1,0], [2,0,-1,0,-1],
             [0,1,1,1,0], [2,-1,0,-1,0]]
        return dict(kind=kind, dimension=4, rank=2, word=[2,1,2,1],
                    C2_word=[1,2,1,2], B=B, H=H, expected_seeds=6,
                    symmetrizer=[2,1])
    raise ValueError("Use A4 or B2.")


def mutate_matrix(B, k):
# Input: An extended exchange matrix B and a mutation direction k.
# Output: The mutated matrix 
    return [[-v if i == k or j == k else v
             + max(B[i][k],0)*max(B[k][j],0)
             - max(-B[i][k],0)*max(-B[k][j],0)
             for j,v in enumerate(row)] for i,row in enumerate(B)]


def mutate_cluster(cluster, B, k):
# Input: Cluster variables, the extended exchange matrix, and direction k.
# Output: The mutated list of cluster variables as exact rational functions.
    plus = minus = cluster[0].parent()(1)
    for i, x in enumerate(cluster):
        plus *= x ** max(B[i][k], 0)
        minus *= x ** max(-B[i][k], 0)
    new = list(cluster)
    new[k] = (plus + minus) / cluster[k]
    return new


def halves(P, k):
# Input: A polytope P and a zero-based coordinate index k.
# Output: [P intersect {y_k >= 0}, P intersect {y_k <= 0}].
    row = [0] * (P.ambient_dim()+1)
    row[k+1] = 1
    return [P.intersection(Polyhedron(ieqs=[h], base_ring=QQ))
            for h in (row, [-x for x in row])]

def tropical_point(point, B, k):
# Input: Point coordinates, the extended exchange matrix, and direction k.
# Output: The coordinates of the point after tropical mutation.
    xk = point[k]
    return [-xk if j == k else x + max(-B[j][k] if xk >= 0 else B[j][k], 0)*xk
            for j,x in enumerate(point)]


def mutate_polytope(P, B, k):
# Input: A polytope, the extended exchange matrix, and direction k.
# Output: The mutated polytope.
# Check: The two transformed halves exactly cover their convex hull.
    images = []
    for half in halves(P, k):
        images.append(Polyhedron(
            vertices=[tropical_point(v, B, k) for v in half.vertices_list()],
            base_ring=QQ))
    Q = images[0].convex_hull(images[1])
    negative, positive = halves(Q, k)[::-1]
    # The two linear pieces reverse the sign of coordinate k.
    assert negative == images[0] and positive == images[1], "Nonconvex tropical image"
    return Q


def make_field(d):
# Input: The number of variables d.
# Output: The rational function field QQ(x1, ..., xd).
    return PolynomialRing(QQ, names=["x"+str(i+1) for i in range(d)]).fraction_field()



def enumerate_seeds(kind, progress=print):
# Input: "A4" or "B2", and an optional progress-reporting function.
# Output: A dictionary containing all seeds, mutation paths, exchange
# matrices, cluster variables, graph edges, and coordinate relabelings.
# Seeds are identified modulo mutable-variable relabeling.
    """Complete BFS modulo mutable-variable relabeling, fixing frozen variables.

    Identity uses exact rational cluster functions. Every revisited seed is
    checked against its full extended matrix after the recorded relabeling.
    The queue, not a depth cutoff or target count, controls termination.
    """
    data = initial_data(kind)
    d, r = data["dimension"], data["rank"]
    field = make_field(d)
    clusters = [list(field.gens())]
    seeds = [dict(id=0, sequence=[], B=data["B"], parent=None, direction=None)]
    seen = {frozenset(clusters[0][:r]): 0}
    directed = []
    cursor = 0
    started = time.monotonic()
    while cursor < len(seeds):
        current = seeds[cursor]
        for k in range(r):
            cluster = mutate_cluster(clusters[cursor], current["B"], k)
            B = mutate_matrix(current["B"], k)
            key = frozenset(cluster[:r])
            if key not in seen:
                if len(seeds) >= data["expected_seeds"]:
                    raise AssertionError("Too many seeds; finite-type identification failed")
                seen[key] = len(seeds)
                clusters.append(cluster)
                seeds.append(dict(id=len(seeds), sequence=current["sequence"]+[k+1],
                                  B=B, parent=cursor, direction=k+1))
            target = seen[key]
            target_cluster = clusters[target]
            permutation = [cluster.index(x) for x in target_cluster]
            assert permutation[r:] == list(range(r,d))
            assert [[B[permutation[i]][permutation[j]] for j in range(r)]
                    for i in range(d)] == seeds[target]["B"]
            directed.append(dict(source=cursor, target=target, direction=k+1,
                                 target_from_mutated=permutation))
        cursor += 1
        if cursor % 50 == 0:
            progress("Seeds processed: %d; discovered: %d (%.1fs)" %
                     (cursor, len(seeds), time.monotonic()-started))
    assert len(seeds) == data["expected_seeds"]
    for seed, cluster in zip(seeds,clusters):
        seed["cluster"] = [str(x) for x in cluster]
    if kind == "B2":
        # Retain the paper's cyclic labels: [] , [1], [1,2], ..., [1,2,1,2,1].
        lookup = {(e["source"],e["direction"]):e["target"] for e in directed}
        order = [0]
        for step in range(5):
            order.append(lookup[(order[-1],1+step%2)])
        assert len(set(order)) == 6 and lookup[(order[-1],2)] == 0
        renumber = {old:new for new,old in enumerate(order)}
        seeds = [dict(seeds[old],id=new,
                      sequence=[1+j%2 for j in range(new)],
                      parent=new-1 if new else None,
                      direction=1+(new-1)%2 if new else None)
                 for new,old in enumerate(order)]
        directed = [dict(e,source=renumber[e["source"]],target=renumber[e["target"]])
                    for e in directed]
        directed.sort(key=lambda e:(e["source"],e["direction"]))
    edges = sorted({tuple(sorted((e["source"],e["target"]))) for e in directed})
    G = Graph([list(range(len(seeds))),edges], format="vertices_and_edges")
    assert G.is_connected() and set(G.degree()) == {r}
    assert G.size() == len(seeds)*r//2 and len(directed) == len(seeds)*r
    progress("Complete: %d seeds; %d undirected edges." % (len(seeds),G.size()))
    return dict(kind=kind, initial=data, seeds=seeds, directed_edges=directed,
                edges=[list(e) for e in edges], complete=True)


def workspace(folder, kind):
# Input: An output directory and the calculation type.
# Action: Create the directory and check checkpoint-version compatibility.
# Output: The directory as a Path object.
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    signature = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    manifest = dict(kind=kind, sage_version=SAGE_VERSION, helper_sha256=signature)
    path = folder/"manifest.json"
    if path.exists():
        if json.loads(path.read_text()) != manifest:
            raise ValueError("Checkpoint version differs. Choose a new output directory.")
    else:
        save_json(path, manifest)
    return folder


def generate(kind, folder, progress=print):
# Input: The calculation type, output directory, and progress function.
# Output: (catalogue, polytopes): seed/graph information and a polytope list.
# Existing compatible checkpoints are reused.
    folder = workspace(folder,kind)
    graph_path = folder/"seeds.json"
    if graph_path.exists():
        catalogue = json.loads(graph_path.read_text())
        progress("Resuming the seed graph previously computed by this verifier.")
    else:
        catalogue = enumerate_seeds(kind,progress)
        save_json(graph_path,catalogue)
    assert catalogue["complete"]
    polytopes = []
    started = time.monotonic()
    for seed in catalogue["seeds"]:
        path = folder/"polytopes"/("%04d.json" % seed["id"])
        if path.exists():
            rows = json.loads(path.read_text())["H"]
            P = Polyhedron(ieqs=rows,base_ring=QQ)
        elif seed["parent"] is None:
            P = Polyhedron(ieqs=catalogue["initial"]["H"],base_ring=QQ)
        else:
            parent = catalogue["seeds"][seed["parent"]]
            P = mutate_polytope(polytopes[seed["parent"]],parent["B"],seed["direction"]-1)
        assert P.dim() == catalogue["initial"]["dimension"] and P.is_compact()
        if not path.exists():
            save_json(path,dict(seed=seed["id"],H=h_rows(P)))
        polytopes.append(P)
        if len(polytopes) % 25 == 0 or len(polytopes) == len(catalogue["seeds"]):
            progress("Polytopes: %d/%d (%.1fs)" %
                     (len(polytopes),len(catalogue["seeds"]),time.monotonic()-started))
    return catalogue,polytopes


def verify_all_edges(catalogue, polytopes, progress=print):
# Input: Seed/graph information, the polytope list, and a progress function.
# Action: Verify polytope mutation along every directed edge,
# including the recorded coordinate relabeling.
# Output: The number of directed edges checked.
    """Optional all-edge geometric check, including coordinate relabeling."""
    for i,e in enumerate(catalogue["directed_edges"]):
        source = catalogue["seeds"][e["source"]]
        Q = mutate_polytope(polytopes[e["source"]],source["B"],e["direction"]-1)
        p = e["target_from_mutated"]
        aligned = Polyhedron(vertices=[[v[j] for j in p] for v in Q.vertices_list()],base_ring=QQ)
        assert aligned == polytopes[e["target"]]
        if (i+1) % 50 == 0:
            progress("Geometric edges verified: %d" % (i+1))
    return len(catalogue["directed_edges"])


def combinatorial_classes(polytopes, folder, progress=print):
# Input: A polytope list, output directory, and progress function.
# Output: A dictionary containing combinatorial classes,
# the number of classes, and representative-comparison records.
    path = Path(folder)/"combinatorial.json"
    if path.exists():
        return json.loads(path.read_text())
    groups, buckets, comparisons = [], defaultdict(list), []
    for i,P in enumerate(polytopes):
        counts = (P.n_vertices(),P.n_facets())
        for group_id in buckets[counts]:
            representative = groups[group_id][0]
            same = bool(P.is_combinatorially_isomorphic(
                polytopes[representative],algorithm="bipartite_graph"))
            comparisons.append(dict(source=i,target=representative,equivalent=same))
            if same:
                groups[group_id].append(i)
                break
        else:
            buckets[counts].append(len(groups))
            groups.append([i])
        if (i+1) % 50 == 0:
            progress("Combinatorial classification: %d/%d; %d classes" %
                     (i+1,len(polytopes),len(groups)))
    result = dict(groups=groups, class_count=len(groups), comparisons=comparisons,
                  criterion="exact vertex-facet incidence isomorphism; vertex/facet counts prefilter")
    save_json(path,result)
    return result


def polar_analysis(P):
# Input: A polytope P.
# Check: Integral vertices and an integral center at facet distance one.
# Output: A dictionary containing the center, the polar normal form,
# and an integral unimodular matrix mapping the polar to that normal form.
    d = P.ambient_dim()
    vertices = [vector(QQ,v) for v in P.vertices_list()]
    assert all(x in ZZ for v in vertices for x in v)
    H = h_rows(P)
    normals = matrix(ZZ,[h[1:] for h in H])
    center = normals.solve_right(vector(ZZ,[1-h[0] for h in H]))
    assert all(x in ZZ for x in center)
    assert all(h[0]+vector(ZZ,h[1:])*center == 1 for h in H)
    polar = LatticePolytope([h[1:] for h in H])
    nf, perm = polar.normal_form(algorithm="palp_native",permutation=True)
    target = matrix(QQ,list(nf)).transpose()
    pv = list(polar.vertices())
    for p in (perm,perm.inverse()):
        source = matrix(QQ,[pv[int(p(i+1))-1] for i in range(len(pv))]).transpose()
        columns = list(source.pivots())
        assert len(columns) == d
        U = target.matrix_from_columns(columns)*source.matrix_from_columns(columns).inverse()
        if U*source == target and all(x in ZZ for x in U.list()) and abs(U.det()) == 1:
            return dict(center=[int(x) for x in center],
                        normal_form=[[int(x) for x in v] for v in nf],
                        polar_to_normal_form=[[int(x) for x in row] for row in U.rows()])
    raise AssertionError("Could not reconstruct an integral normal-form transformation")


def affine_map(P,Q,left,right):
# Input: Two polytopes and their respective polar_analysis results.
# Output: A dictionary containing a verified affine map y = A*x + b
# and its verification data, or None if the normal forms differ.

    if left["normal_form"] != right["normal_form"]:
        return None
    polar_map = matrix(ZZ,right["polar_to_normal_form"]).inverse()*matrix(ZZ,left["polar_to_normal_form"])
    A = polar_map.inverse().transpose()
    b = vector(ZZ,right["center"])-A*vector(ZZ,left["center"])
    assert all(x in ZZ for x in list(A.list())+list(b)) and abs(A.det()) == 1
    assert {tuple(A*vector(QQ,v)+b) for v in P.vertices_list()} == set(map(tuple,Q.vertices_list()))
    assert {tuple(polar_map*vector(ZZ,h[1:])) for h in h_rows(P)} == {tuple(h[1:]) for h in h_rows(Q)}
    return dict(A=[[int(x) for x in row] for row in A.rows()],b=[int(x) for x in b],
                determinant=int(A.det()), all_vertices_verified=True,
                all_polar_vertices_verified=True, convention="target_column = A*source_column+b")


def unimodular_classes(polytopes,folder,progress=print):
# Input: A polytope list, output directory, and progress function.
# Output: A dictionary containing affine unimodular classes, polar
# analyses, and verified affine maps to the class representatives.
    groups, seen, analyses, certificates = [], {}, [], []
    for i,P in enumerate(polytopes):
        path = Path(folder)/"normal_forms"/("%04d.json"%i)
        if path.exists():
            analysis = json.loads(path.read_text())
        else:
            analysis = polar_analysis(P)
            save_json(path,analysis)
        key = tuple(map(tuple,analysis["normal_form"]))
        if key not in seen:
            seen[key] = len(groups)
            groups.append([])
        group = groups[seen[key]]
        representative = group[0] if group else i
        target_analysis = analyses[representative] if group else analysis
        certificate = affine_map(P,polytopes[representative],analysis,target_analysis)
        certificates.append(dict(source=i,target=representative,**certificate))
        group.append(i)
        analyses.append(analysis)
        if (i+1)%25 == 0 or i+1 == len(polytopes):
            progress("Unimodular classification: %d/%d; %d classes" %
                     (i+1,len(polytopes),len(groups)))
    result = dict(groups=groups,class_count=len(groups),analyses=analyses,certificates=certificates)
    save_json(Path(folder)/"unimodular.json",result)
    return result


def colored_automorphisms(catalogue,groups):
# Input: Seed/graph information and a partition into equivalence classes.
# Output: A dictionary containing the full and color-preserving group
# orders and structures, plus the color-preserving permutations,
# generators, and orbits.
# Each equivalence class must be preserved setwise.
    n = len(catalogue["seeds"])
    G = Graph([list(range(n)),catalogue["edges"]],format="vertices_and_edges")
    colors = {v:c for c,group in enumerate(groups) for v in group}
    assert sorted(colors) == list(range(n))
    full = G.automorphism_group()
    colored = G.automorphism_group(partition=groups)
    permutations = [[int(p(i)) for i in range(n)] for p in colored]
    expected = {tuple(int(p(i)) for i in range(n)) for p in full
                if all(colors[i] == colors[int(p(i))] for i in range(n))}
    assert {tuple(p) for p in permutations} == expected
    edges = {tuple(sorted(e)) for e in catalogue["edges"]}
    for p in permutations:
        assert all(colors[i] == colors[p[i]] for i in range(n))
        assert {tuple(sorted((p[a],p[b]))) for a,b in edges} == edges
    return dict(ambient_order=int(full.order()),ambient_structure=full.structure_description(),
                colored_order=int(colored.order()),colored_structure=colored.structure_description(),
                permutations=permutations,
                generators=[[int(p(i)) for i in range(n)] for p in colored.gens()],
                orbits=[sorted(map(int,o)) for o in colored.orbits()])


def cycle_notation(permutation):
# Input: A permutation list whose i-th entry is the image of i.
# Output: A cycle-notation string such as "(0 5)(1 4)(2 3)".
    unseen,cycles = set(range(len(permutation))),[]
    while unseen:
        start = min(unseen)
        cycle, v = [], start
        while v in unseen:
            cycle.append(v); unseen.remove(v); v = permutation[v]
        if len(cycle)>1:
            cycles.append("("+" ".join(map(str,cycle))+")")
    return "".join(cycles) or "()"


def b2_weight_polytope(catalogue,seed_id,a,b):
# Input: Seed information, a seed ID, and positive integer C2 weight
# coefficients a and b.
# Output: The polytope obtained along the recorded mutation path
# at weight a*omega_1 + b*omega_2 in C2 numbering.
    """Replay the selected B2 path at a positive integral C2 weight (a,b)."""
    if a not in ZZ or b not in ZZ or a<=0 or b<=0:
        raise ValueError("Use positive integral C2 weight coefficients.")
    H = initial_data("B2")["H"]
    H = [row[:] for row in H]
    for row,value in zip((1,3,5,7),(b,a,b,a)):
        H[row][0] = value
    P = Polyhedron(ieqs=H,base_ring=QQ)
    B = initial_data("B2")["B"]
    for direction in catalogue["seeds"][seed_id]["sequence"]:
        P = mutate_polytope(P,B,direction-1)
        B = mutate_matrix(B,direction-1)
    return P
