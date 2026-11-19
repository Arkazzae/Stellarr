# Builds every recipe of artifacts/recipes/ into its out/ folder, where
# artifacts/assemble.mjs reads it:
#
#   docker buildx bake recipes
#
# Run it once in a fresh checkout or worktree, and again after a recipe
# changes, before `npm run dev`, `npm test` or `npm run build` in web/. The
# stages are the root Dockerfile's, so this builds exactly what the image
# build does; artifacts/recipes/README.md says more.

# Each recipe that artifacts/manifest.json names, by the name of its folder.
variable "RECIPES" {
  default = ["speex", "bergamot", "rnnoise", "gtcrn"]
}

# "gha" in CI: each recipe then reads and writes a GitHub Actions cache of
# its own. It keeps only the outputs (mode=min, the default), a few kilobytes
# to a few megabytes, which is enough for a recipe that did not change to be
# taken whole from the cache without its toolchain even being pulled.
# mode=max would also keep every layer of every step, a toolchain image of a
# gigabyte or more among them, in a repository cache that the image job
# already fills.
variable "RECIPE_CACHE" {
  default = ""
}

group "recipes" {
  targets = ["recipe"]
}

target "recipe" {
  name       = "recipe-${name}"
  matrix     = { name = RECIPES }
  dockerfile = "Dockerfile"
  context    = "."
  target     = "recipe-${name}"
  output     = ["type=local,dest=artifacts/recipes/${name}/out"]
  # Only the outputs belong in out/; buildx in CI would add provenance.json.
  attest     = ["type=provenance,disabled=true"]
  cache-from = RECIPE_CACHE == "gha" ? ["type=gha,scope=recipe-${name}"] : []
  cache-to   = RECIPE_CACHE == "gha" ? ["type=gha,scope=recipe-${name}"] : []
}
