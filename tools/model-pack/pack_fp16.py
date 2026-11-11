# Weights-only fp16 pack: float32 initializers -> float16 + Cast(->float32) node. Graph maths stays fp32; only stored weights are rounded.
import sys, numpy as np, onnx
from onnx import numpy_helper, TensorProto, helper
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
stats = {'conv': 0, 'skip': 0, 'maxrel': 0.0}
def proc(g):
    new_inits, casts = [], []
    consumers = {}
    for n in g.node:
        for i in n.input: consumers.setdefault(i, []).append(n)
    for init in list(g.initializer):
        if init.data_type != TensorProto.FLOAT: continue
        a = numpy_helper.to_array(init)
        if a.size < 128: stats['skip'] += 1; continue
        mx = float(np.abs(a).max())
        if mx > 60000: stats['skip'] += 1; continue
        h = a.astype(np.float16); back = h.astype(np.float32)
        nz = np.abs(a) > 1e-4
        if nz.any(): stats['maxrel'] = max(stats['maxrel'], float((np.abs(back-a)[nz]/np.abs(a)[nz]).max()))
        name16 = init.name + '__fp16'
        new_inits.append(numpy_helper.from_array(h, name16))
        casts.append(helper.make_node('Cast', [name16], [init.name + '__cast'], to=TensorProto.FLOAT, name='cast_' + init.name))
        for n in consumers.get(init.name, []):
            for k, i in enumerate(n.input):
                if i == init.name: n.input[k] = init.name + '__cast'
        for o in g.output:
            if o.name == init.name: raise SystemExit('initializer is graph output')
        g.initializer.remove(init); stats['conv'] += 1
    g.initializer.extend(new_inits)
    nodes = list(g.node); del g.node[:]; g.node.extend(casts + nodes)
    for n in nodes:
        for at in n.attribute:
            if at.type == onnx.AttributeProto.GRAPH: proc(at.g)
            elif at.type == onnx.AttributeProto.GRAPHS:
                for sg in at.graphs: proc(sg)
proc(m.graph)
onnx.checker.check_model(m)
onnx.save(m, dst)
print(src, '->', dst, stats)
