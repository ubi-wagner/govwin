# Harvest fixtures — the internet, as far as this box is concerned

`HARVEST_DRIVER=fixture` (the default) makes `lib/harvest/fetch.ts` read from this directory
instead of the network. It exists because the sandbox **cannot reach a solicitation site** —
`curl https://sam.gov` answers `000`, and so does `dodsbirsttr.mil` — so a harvester with only a
live driver would be code that has never run end to end here.

This is the same choice the repo already made for the Claude API (`EMULATE=1` → the :8787
harness): a committed stand-in that exercises the real path with no live dependency.

## How a URL maps to a file

`fixturePathFor()` in `lib/harvest/fetch.ts`: `host/pathname`, with the query string folded into
the leaf. So a fixture is findable by eye from the URL it stands for, and adding one means saving
a file rather than editing a registry.

    https://www.example.gov/opportunities/AF251-D001
      → www.example.gov/opportunities/AF251-D001

A **miss is a 404**, not a throw and not a silent skip — the corpus standing in for the internet
has to be able to say "that page is not here" in the shape the internet does.

## What this corpus is FOR

It reproduces the problem cross-source matching exists to solve: **the same solicitation, posted
on two sites, under two different titles and two different filenames, with byte-identical PDFs.**

    www.example.gov      the issuing component's own page
    aggregator.example.com   a third-party notice board carrying the same opportunity

`topics.pdf` and `AF251-D001_topics_v2.pdf` are the same bytes. Their sha256 agrees; their
filenames do not. That is the case a title matcher cannot see and a content hash settles instantly.

## The thing these fixtures must never be mistaken for

Every row harvested from here is stamped `harvest_driver = 'fixture'`. A document that came from
this directory must not look like one fetched from an agency, or the claim "the same file appears
on two sites" rests on bytes this repo wrote itself.
