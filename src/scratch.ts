import { Cascade } from ".";

const a = Cascade.const(null);
const b = new Cascade(() => Math.random());

const c = new Cascade(async (_, deps) => {
  deps(a, b);

  await new Promise((res) => setTimeout(res, 1000));

  return Math.floor(Math.random() * 100);
}).p((v) => {
  console.log("c", v);
  return v;
});

const d = c.p(async (v) => {
  await new Promise((res) => setTimeout(res, 1000));
  return v * 2;
});

d.p((v) => console.log("d", v)).catch((e) => console.log(e));

d.next().then((v) => console.log("next", v));

setTimeout(() => a.invalidate(), 3000);

setTimeout(() => b.invalidate(), 4000);
