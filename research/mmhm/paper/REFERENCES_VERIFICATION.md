# Reference verification log (refs.bib)

Method: every entry was checked with web search (WebFetch/curl to publisher
sites were blocked). A field appears in `refs.bib` only if a search result
supported it. Fields that no result confirmed were **omitted**, never guessed.
The "Source" column gives the URL(s) returned by the search that carried the
confirming data.

Checked on 2026-10-11; revision entries (`bauer2024wrapping`, `skoldberg2006morse`,
`jollenbeck2009minimal`) checked the same day with web search only.

| Key | Verified (fields) | Omitted / caveats | Source |
|---|---|---|---|
| `forman1998morse` | authors, title, Adv. Math. 134, 90–145, 1998 | DOI not confirmed by any result (an `aima.1997.1650` guess was not found), so omitted; issue no. omitted | https://webhomes.maths.ed.ac.uk/~v1ranick/papers/forman5.pdf ; https://www.maths.dur.ac.uk/users/dirk.schuetz/teaching/projectIII26-27.html |
| `forman2002user` | authors, title, Sém. Lothar. Combin. 48, art. B48c, 2002 | — | https://www.mat.univie.ac.at/~slc/wpapers/s48forman.html ; https://www.mat.univie.ac.at/~slc/wpapers/s48.html |
| `mrozek2009coreduction` | authors, title, DCG 41, 96–118, 2009 | DOI `10.1007/s00454-008-9073-y` (used in v1) not confirmed by any result, so omitted; issue no. omitted | https://apacz.matinf.uj.edu.pl/publikacje/6785-coreduction_homology_algorithm ; https://capd.sourceforge.net/capdRedHom/algorithms.php |
| `mrozek2010coreduction` (v1 ref) | authors, title, Comput. Math. Appl. 60(10), 2812–2833, 2010 | **DOI conflict:** v1 used `10.1016/j.camwa.2010.08.063`; a search summary of Wanner's page gave `10.1016/j.camwa.2010.09.036`. Neither independently confirmed, so DOI omitted | https://math.gmu.edu/~wanner/publications/048_coredp/ |
| `dlotko2011coreduction` (v1 ref) | authors, title, DCG 46(2), 361–388, 2011, DOI 10.1007/s00454-010-9303-y | — | https://link.springer.com/article/10.1007/s00454-010-9303-y ; https://math.gmu.edu/~wanner/publications/050_cwcored/ |
| `harker2014discrete` | authors, title, FoCM 14, 151–184, 2014, DOI 10.1007/s10208-013-9145-0 | issue no. omitted | https://apacz.matinf.uj.edu.pl/publikacje/7076-discrete_morse_theoretic_algorithms_for_computing_homology_of_complexes_and_maps ; https://ww2.ii.uj.edu.pl/~mrozek/papers/index.html |
| `mischaikow2013morse` | authors, title, DCG 50(2), 330–353, 2013, DOI 10.1007/s00454-013-9529-6 | — | https://ora.ox.ac.uk/objects/uuid:16bb672e-de64-48ee-8497-1653482e6ebe ; https://people.maths.ox.ac.uk/nanda/source/DMPers-Final.pdf |
| `benedetti2014random` | authors, title, Exp. Math. 23(1), 66–94, 2014 (arXiv:1303.6422 journal-ref) | DOI not confirmed, omitted. Algorithm description used in related.tex (random free-face collapse; critical only when no free face) confirmed from the arXiv text | https://arxiv.org/abs/1303.6422v2 ; https://www3.math.tu-berlin.de/IfM/Nachrufe/Frank_Lutz/stellar/library_of_triangulations |
| `lewiner2003optimal` | authors, title, Comput. Geom. 26(3), 221–233, 2003 (DBLP) | DOI (v1 used `10.1016/S0925-7721(03)00004-9`) not confirmed, omitted. The "linear time on 2-manifolds" statement in related.tex rests on Lewiner's thesis abstract as summarised by search, not on the journal page | https://dblp.dagstuhl.de/pid/84/1857.html ; https://sugaku.net/oa/A5102161188 |
| `edelsbrunner2002topological` | authors, title, DCG 28(4), 511–533, 2002, DOI 10.1007/s00454-002-2885-2 | Not to be confused with the FOCS 2000 version | https://research-explorer.ista.ac.at/record/3996 ; https://pub.ista.ac.at/~edels/Papers/2002-04-TopologicalPersistence.pdf |
| `zomorodian2005computing` | authors, title, DCG 33(2), 249–274, 2005, DOI 10.1007/s00454-004-1146-y | — | https://dblp.org/pid/08/1955 ; https://www.scinapse.io/papers/2144044408 |
| `edelsbrunner2010computational` | authors, title, AMS, Providence, 2010, ISBN 978-0-8218-4925-5, DOI 10.1090/mbk/069 | **v1's DOI `10.1007/978-3-540-33259-6_7` is wrong** (a Springer chapter DOI); replaced by the AMS DOI | https://research-explorer.ista.ac.at/record/3899 ; https://scholars.duke.edu/publication/851239 ; https://prometeus.nsc.ru/acquisitions/14-10-21/cont13f.ssi |
| `chen2011twist` | authors, title, EuroCG 2011 (27th), Morschach, pp. 197–200 | — | https://research-explorer.ista.ac.at/record/3270 ; https://repositum.tuwien.at/cris/books/books99213 |
| `bauer2014clear` | authors, title, Topological Methods in Data Analysis and Visualization III, Springer 2014, pp. 103–117, DOI 10.1007/978-3-319-04099-8_7 | Editors (Bremer, Hotz, Pascucci, Peikert) seen by surname only, so editor field omitted; series omitted | https://research-explorer.ista.ac.at/record/2044 ; https://www.springerprofessional.de/en/clear-and-compress-computing-persistent-homology-in-chunks/2079118 ; https://arxiv.org/abs/1303.0477 |
| `bauer2017phat` | authors, title, J. Symb. Comput. 78, 76–90, 2017, DOI 10.1016/j.jsc.2016.03.008 | An ICMS 2014 conference version also exists; we cite the journal | https://research-explorer.ista.ac.at/record/1433 ; https://mediatum.ub.tum.de/node?id=1718853 |
| `bauer2021ripser` | author, title, JACT 5(3), 391–423, 2021, DOI 10.1007/s41468-021-00071-5. Apparent-pair facts used in related.tex (local condition; both persistence and gradient pairs) | — | https://mediatum.ub.tum.de/1704829 ; https://arxiv.org/abs/1908.02518v2 ; https://ulrich-bauer.org/apparent-pairs-talk-palermo.pdf |
| `maria2014gudhi` | authors, title, ICMS 2014, LNCS 8592, pp. 167–174, Springer | DOI not confirmed (chapter number unknown), omitted | https://researchportal.ip-paris.fr/en/publications/the-gudhi-library-simplicial-complexes-and-persistent-homology/ ; https://hal.archives-ouvertes.fr/hal-01108461 |
| `otter2017roadmap` | authors, title, EPJ Data Sci. 6:17, 2017, DOI 10.1140/epjds/s13688-017-0109-5 | — | https://ora.ox.ac.uk/objects/uuid:dff984db-e1ed-4701-834b-a1ae5be42a74 ; https://arxiv.org/abs/1506.08903 |
| `cohensteiner2006vines` | authors, title, SoCG 2006, pp. 119–126, DOI 10.1145/1137856.1137877 | — | https://research-explorer.ista.ac.at/record/3559 ; https://mrzv.org/publications/vineyards/ |
| `carlsson2010zigzag` | authors, title, FoCM 10, 367–405, 2010, DOI 10.1007/s10208-010-9066-0 | issue no. omitted | https://link.springer.com/article/10.1007/s10208-010-9066-0 ; https://arxiv.org/abs/0812.0197 |
| `carlsson2009zigzag` | authors, title, SoCG 2009, pp. 247–256, DOI 10.1145/1542362.1542408 | — | https://www.mrzv.org/publications/zigzags/ ; https://mrzv.org/publications/zigzags/socg09 |
| `dey2022fast` | authors, title, ESA 2022, LIPIcs 244, 43:1–43:15, DOI 10.4230/LIPIcs.ESA.2022.43 | — | https://drops.dagstuhl.de/opus/volltexte/2022/16981/ ; https://par.nsf.gov/biblio/10440101 |
| `delfinado1995incremental` | authors, title, CAGD 12(7), 771–784, 1995, DOI 10.1016/0167-8396(95)00016-Y; O(n α(n)) bound; union–find on complex and complement; β1 via Euler characteristic | The complement/Euler mechanism is from secondary summaries (course notes), not the abstract | https://research-explorer.ista.ac.at/record/4029 ; https://cs.nyu.edu/~yap/classes/modeling/06f/lect/delfinado_betti_cagd.pdf ; https://courses.cs.duke.edu/fall06/cps296.1/Homeworks/hw-VI.pdf |
| `holm2001polylog` | authors, title, J. ACM 48(4), 723–760, 2001, DOI 10.1145/502090.502095 | — | https://www.cs.princeton.edu/courses/archive/fall09/cos521/Handouts/polylogarithmic.pdf ; https://arxiv.org/pdf/2102.11169 |
| `luo2023warmstart` | authors, title, Computational Geometry, 2024, DOI 10.1016/j.comgeo.2024.102089; arXiv:2108.05022 (2021) | **Year is 2024, not 2023** (key kept as required). Volume / article number not confirmed, omitted | https://ma.x-mol.com/paper/1765550179327119360 ; https://arxiv.org/pdf/2108.05022 |
| `pachner1991pl` | author, title, Europ. J. Combin. 12(2), 129–145, 1991, DOI 10.1016/S0195-6698(13)80080-7 | Only the Wikipedia citation carried full details | https://en.wikipedia.org/wiki/Pachner_moves |
| `hatcher2002algebraic` | author, title, Cambridge University Press, 2002 | — | https://spdes-bib.readthedocs.io/en/latest/bib_entries/hatcher:02:algebraic.html ; https://pi.math.cornell.edu/~hatcher/AT/AT..pdf |
| `munkres1984elements` | author, title, Addison-Wesley, Menlo Park, 1984 | — | https://library.math.carleton.ca/vufind/Record/2491 ; https://libcat.library.tamu.edu/Record/in00000542795 |
| `carlsson2009topology` | author, title, Bull. AMS 46, 255–308, 2009, DOI 10.1090/S0273-0979-09-01249-X | issue no. omitted | https://www.doi.org/10.1090/S0273-0979-09-01249-X |
| `ouyang2025mmhm_v1` | author, title, arXiv:2508.14429v1 [cs.CG], 2025 | Checked against the v1 PDF itself | https://arxiv.org/pdf/2508.14429 ; https://arxiv.org/html/2508.14429v1 |

## Extra entries (not on the required list)

| Key | Why included | Verified (fields) | Omitted / caveats | Source |
|---|---|---|---|---|
| `giunti2026pruning` | Updates R = DV and representatives under simplex removal: the closest published analogue of our deletion step | authors, title (journal version adds "and representative cycles"), Foundations of Data Science, DOI 10.3934/fods.2026007, early access; arXiv:2312.03925 | Volume/pages (a SUNY profile says vol. 11, 207–232) not confirmed on the publisher page, omitted | https://www.aimsciences.org/article/doi/10.3934/fods.2026007 ; https://export.arxiv.org/abs/2312.03925 |
| `milosavljevic2011zigzag` | Zigzag (insertions + deletions) in matrix-multiplication time | authors, title, SoCG 2011 (27th), pp. 216–225, DOI 10.1145/1998196.1998229 | — | https://mrzv.org/publications/zzph-mmt/ |
| `dey2021zigzag` | Near-linear zigzag on graphs via HDT dynamic connectivity | authors, title, SoCG 2021, LIPIcs 189, 30:1–30:15, DOI 10.4230/LIPIcs.SoCG.2021.30 | — | https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.SoCG.2021.30 |
| `dey2024vineyard` | Vineyard updates for zigzag, incl. expansions/contractions | authors, title, SoCG 2024, LIPIcs 293, 49:1–49:15, DOI 10.4230/LIPIcs.SoCG.2024.49 | — | https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.SoCG.2024.49 |
| `maria2024discrete` | Discrete Morse preprocessing for zigzag (Morse + insert/delete) | authors, title, DCG 71(2), 708–737, 2024 (DBLP); WADS 2019 conf. version (pp. 538–552) | DOI not confirmed, omitted | https://dblp1.uni-trier.de/pid/194/3156.html ; https://graz.elsevierpure.com/de/publications/discrete-morse-theory-for-computing-zigzag-persistence-2 |
| `dey2014simplicial` | Z2 annotations maintained under elementary inclusions and collapses | authors, title, SoCG 2014 (30th) | Pages and DOI not confirmed, omitted | https://www.arxiv.org/abs/1208.5018 ; https://www.cs.purdue.edu/homes/tamaldey/SimPers/Simpers.html |
| `eppstein2003dynamic` | Dynamic tree–cotree / fundamental-group generators for surface-embedded graphs | author, title, SODA 2003 (14th), pp. 599–608 | — | https://ics.uci.edu/~eppstein/pubs/p-dyngen.html ; https://arxiv.org/abs/cs/0207082 |
| `bauer2024wrapping` | Revision (referee M13): prior work relating gradient pairs of a discrete Morse function to apparent pairs; cited in theory.tex (Remark on known results) and related.tex | authors (Ulrich Bauer, Fabian Roll), title, SoCG 2024, LIPIcs 293, 15:1–15:16, editors Mulzer and Phillips, DOI 10.4230/LIPIcs.SoCG.2024.15; full version arXiv:2212.02345 | The content is cited only as "relates the gradient pairs of a (generalised) discrete Morse function to the zero-persistence apparent pairs of a lexicographically refined order". Search summaries place this in its Sec. 4.1 (Lemma 2, Prop. 7, building on Lemma 9 of Bauer–Roll SoCG 2022); the full text could not be fetched here (arxiv.org and drops.dagstuhl.de unreachable), so no proposition number is cited | https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.SoCG.2024.15 ; https://arxiv.org/abs/2212.02345 ; https://portal.fis.tum.de/en/publications/wrapping-cycles-in-delaunay-complexes-bridging-persistent-homolog/ |
| `skoldberg2006morse` | Revision (referee M13): algebraic Morse theory, cited where theory.tex and related.tex describe the Morse complex as elimination of matched pairs | author (Emil Sköldberg), title, Trans. AMS 358(1), 115–129, 2006 | DOI not confirmed, omitted; one repository dates the online version August 2005 | https://research.universityofgalway.ie/en/publications/morse-theory-from-an-algebraic-viewpoint-5/ ; https://researchrepository.universityofgalway.ie/entities/publication/6c2848df-1cfb-496c-953a-7a3bbc8ce5a5 |
| `jollenbeck2009minimal` | Revision (referee M13): algebraic discrete Morse theory (independent of Sköldberg), same citation sites | authors (Michael Jöllenbeck, Volkmar Welker), title, Mem. AMS 197(923), 2009, vi+74 pp. | DOI not confirmed, omitted; an AMS e-book edition dated 2012 also exists | https://bookstore.ams.org/MEMO/197/923 ; https://www.sudoc.fr/13114829X ; https://web3.arxiv.org/pdf/math/0501179 |

`dlotko2011coreduction` and `mrozek2010coreduction` are v1 references kept for
the coreduction paragraph (listed in the main table).

## Searched for, not added

- Fully dynamic Betti-number data structures for general complexes, and
  maintenance of discrete gradients under complex edits: searches found nothing
  beyond the special cases cited (β0 via dynamic connectivity, S^3
  insertion-only, surface-embedded graphs) and v1 itself.
- Dey & Hou, "Updating barcodes and representatives for zigzag persistence"
  (arXiv:2112.02352): exists, but no publication venue was confirmed and the
  SoCG 2024 zigzag-vineyard paper covers the relevant content, so it was left
  out.
- Bauer & Roll, SoCG 2022 (apparent pairs in Rips filtrations), and Kerber &
  Schreiber, barcodes of towers: verified but not needed for the argument.
  (In the revision, Bauer & Roll's SoCG 2024 paper `bauer2024wrapping` was added
  instead, at the referee's request; see the table above.)
- Kozlov, *Combinatorial Algebraic Topology*: a standard algebraic Morse theory
  reference, not added because Sköldberg and Jöllenbeck–Welker were verified and
  suffice.
