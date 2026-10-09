# Git command handbook

Command headings follow "**function name · `git command`**". Every entry covers **purpose**, **common flags**, and **examples**; examples consistently use the GitHub repository `gitter-demo/todo-app`. All commands run directly on the Terminal page.

## 1. Configuration and repository setup

### Configure git config
Set user identity, editor, aliases and more. `--global` writes user-level config (~/.gitconfig); with no scope flag it only applies to the current repository.

| Flag | Meaning |
| --- | --- |
| --global | Read/write the current user's global config |
| --local | Read/write the current repository's config (default) |
| --list | List config keys with their source |
| alias.name "command" | Define a command alias, e.g. alias.st "status -sb" |

**Example**

```bash
git config --global user.name "wyndam"
git config --global user.email "wyndam@example.com"
git config --global alias.st "status -sb"       # alias: git st
git config --global init.defaultBranch main     # default main branch for new repos
git config --list --global
```

### Initialize a repository git init
Turn the current directory into a Git repository (creates .git).

| Flag | Meaning |
| --- | --- |
| directory | Create a new repository in the given directory |
| -b name | Set the initial branch name |
| --bare | Create a bare repository without a working tree (server side) |

**Example**

```bash
git init todo-app          # create and initialize the todo-app repository
git init -b main           # initialize the current directory, initial branch main
```

### Clone a remote repository git clone
Copy a remote repository (GitHub and others) to local disk — sets up `origin` and checks out the default branch automatically.

| Flag | Meaning |
| --- | --- |
| url | Repository address (HTTPS / SSH / local path) |
| directory | Name of the local directory |
| -b branch | Check out the given branch after cloning |
| --depth 1 | Shallow clone: only the latest commit |
| --recurse-submodules | Fetch and initialize submodules as well |

**Example** (HTTPS and SSH variants)

```bash
git clone https://github.com/gitter-demo/todo-app.git
git clone git@github.com:gitter-demo/todo-app.git          # SSH protocol
git clone -b dev --depth 1 https://github.com/gitter-demo/todo-app.git todo-app-dev
```

## 2. Daily high-frequency commands

### Check status git status
Show the state of the working tree and index — the command you will use most.

| Flag | Meaning |
| --- | --- |
| -s | Short form (two-column status codes) |
| -b | Also show branch and ahead/behind counts |
| --ignored | List ignored files as well |

**Example**

```bash
git status
git status -sb         # branch info + short form
```

### Stage changes git add
Move changes into the index so they are ready to be committed.

| Flag | Meaning |
| --- | --- |
| path | Stage a specific file or directory |
| -A / --all | Stage everything, including deletions |
| -p / --patch | Stage hunks one by one interactively |
| --update | Stage modified and deleted files only |

**Example**

```bash
git add src/app.ts
git add -A
git add -p src/app.ts          # pick hunks interactively
```

### Commit git commit
Record the staged index as a new commit.

| Flag | Meaning |
| --- | --- |
| -m message | Commit message without opening an editor |
| -a | Auto-stage modified and deleted tracked files |
| -amend | Modify the previous commit (rewrite history — never on shared branches) |
| -v | Show the full diff inside the commit message |

**Example**

```bash
git commit -m "fix: handle empty repo"
git commit -am "docs: add contributing guide"
git commit --amend --no-edit   # fix a typo in the last message
```

### View history git log
Show the commit history, with filtering and formatting.

| Flag | Meaning |
| --- | --- |
| --oneline | One line per commit |
| --graph | ASCII history graph |
| --follow | Follow a file across renames |
| --since / --after | Only commits after the given date |
| --author=name | Filter by author |

**Example**

```bash
git log --oneline --graph --decorate -20
git log --oneline --follow src/app.ts
git log --since="2 weeks ago" --author=wyndam
```

### Compare diffs git diff
Compare the working tree, the index, and commits.

| Flag | Meaning |
| --- | --- |
| --stat | Change summary only |
| --cached | Compare index against HEAD instead of working tree |
| --name-only | File names only |
| path | Limit the diff to a path |

**Example**

```bash
git diff                     # working tree vs index
git diff --cached            # index vs HEAD
git diff --stat HEAD~2..HEAD
```

### Manage branches git branch
Create, list, and delete local branches.

| Flag | Meaning |
| --- | --- |
| -a | Include remote-tracking branches |
| -d name | Delete a branch (only if fully merged) |
| -D name | Force delete |
| -m old new | Rename a branch |

**Example**

```bash
git branch
git branch -a
git branch feature/login
git branch -d feature/login
```

### Switch and check out git switch / git checkout
`git switch` switches branches, `git checkout` also restores files — both do both.

| Flag | Meaning |
| --- | --- |
| branch | Switch to a branch |
| --create / -c | Create and switch in one step |
| --detach | Check out a commit in detached HEAD state |
| -- file | Restore a file from a branch or commit |

**Example**

```bash
git switch dev
git switch -c feature/login
git checkout HEAD -- src/app.ts   # discard local changes to a file
```

### Merge branches git merge
Merge another branch into the current branch.

| Flag | Meaning |
| --- | --- |
| --no-ff | Always create a merge commit |
| --squash | Squash the other branch into a single commit |
| -m message | Set the merge commit message |
| --abort | Cancel a conflicted merge |

**Example**

```bash
git merge feature/login
git merge --no-ff feature/login
git merge --abort
```

### Rebase git rebase
Replay your commits on top of another branch, keeping a linear history.

| Flag | Meaning |
| --- | --- |
| branch | Rebase the current branch onto branch |
| --onto newbase | Change where the commits are applied |
| --continue / --abort | Resolve conflicts / bail out |
| -i | Interactive rebase (edit, reorder, squash) |

**Example**

```bash
git rebase main
git rebase --continue
git rebase -i HEAD~3
```

### Stash changes git stash
Shelve uncommitted work temporarily, then pick it back up.

| Flag | Meaning |
| --- | --- |
| save [name] | Stash the current changes |
| pop | Stash and restore the latest entry |
| apply | Restore without dropping the stash |
| list | Show all stash entries |

**Example**

```bash
git stash save "wip before rebase"
git stash list
git stash pop
```

### Undo changes git reset / git restore
`git reset` moves a branch pointer, `git restore` restores file contents.

| Flag | Meaning |
| --- | --- |
| --soft / --mixed / --hard | Keep index / keep working tree / discard everything |
| -- path | Mixed: unstage a file without touching the working tree |

**Example**

```bash
git reset --soft HEAD~1     # undo the commit, keep changes staged
git reset --mixed src/app.ts
git restore src/app.ts      # discard working tree changes
git restore --staged src/app.ts
```

### Fetch and pull updates git fetch / git pull
`git fetch` downloads without merging; `git pull` fetches and merges in one step.

| Flag | Meaning |
| --- | --- |
| remote | Remote to contact (default origin) |
| branch | Fetch a specific branch |
| --prune | Delete remote-tracking branches that no longer exist |
| --rebase | Rebase instead of merging on pull |

**Example**

```bash
git fetch origin
git fetch --prune
git pull --rebase
```

### Push git push
Upload local commits to a remote branch.

| Flag | Meaning |
| --- | --- |
| -u | Set the upstream so plain `git push` works afterwards |
| --force / -f | Overwrite remote history (dangerous on shared branches) |
| --force-with-lease | Safer force: refuse if the remote moved since your last fetch |
| --no-verify | Skip pre-push hooks |

**Example**

```bash
git push -u origin feature/login
git push --force-with-lease
```

### Tag releases git tag
Create lightweight and annotated tags and push them to a remote.

| Flag | Meaning |
| --- | --- |
| name | Lightweight tag at HEAD |
| -a name -m msg | Annotated tag with a message |
| -l | List all tags |
| --delete name | Delete a tag |

**Example**

```bash
git tag -a v1.0.0 -m "release v1.0.0"
git tag -l
git push origin v1.0.0
```

### Manage remotes git remote
Inspect and modify the configured remote repositories.

| Flag | Meaning |
| --- | --- |
| show name | Detailed info for one remote |
| add name url | Add a remote |
| rename old new | Rename a remote |
| set-url name url | Change a remote's URL |

**Example**

```bash
git remote -v
git remote add fork https://github.com/wyndam/todo-app.git
git remote set-url origin git@github.com:gitter-demo/todo-app.git
```

## 3. Every other command by category

The remaining commands are collected below (plumbing included) in the same **purpose → flags → examples** shape.

### Inspect and history

#### Show an object git show
Show a commit, tag, or object together with its diff.
**Flags**: `object` commit/tag/SHA · `--stat` stats only · `--name-only` file names only

```bash
git show v1.0.0
git show 9bb416d --stat
```

#### Summarize by author git shortlog
Aggregate commits per author — handy for contribution stats.
**Flags**: `-s` counts only · `-n` sort by count · `-e` show e-mail

```bash
git shortlog -sn --since="2026-01-01"
```

#### Derive a version string git describe
Build a readable version from the nearest reachable tag (e.g. v1.0.0-3-g9bb416d).
**Flags**: `--tags` include lightweight tags · `--abbrev=n` SHA length · `--dirty` mark dirty trees

```bash
git describe --tags --dirty      # generate a version string in a release script
```

#### Trace lines git blame
Show the last commit that touched each line.
**Flags**: `-L from,to` limit the range · `-e` show e-mail · `-w` ignore whitespace-only changes

```bash
git blame -L 10,20 src/app.ts
```

#### Reflog git reflog
Local history of HEAD and branch movements — the lifeboat for finding "lost" commits.
**Flags**: `ref` follow a specific branch · `--date=iso` absolute timestamps

```bash
git reflog
git reset --hard HEAD@{2}        # jump back two movements
```

#### Bisect a regression git bisect
Binary search for the commit that introduced a defect.
**Flags**: `start / bad / good` mark the range · `run script` automate · `reset` finish

```bash
git bisect start
git bisect bad HEAD
git bisect good v1.0.0           # switches commits until the culprit is found
git bisect reset
```

#### Search tracked content git grep
Pattern search inside tracked file content (repository content only, fast).
**Flags**: `-n` line numbers · `-i` case-insensitive · `-e pattern` multiple patterns

```bash
git grep -n "TODO" -- "*.ts"
```

#### Compare two ranges git range-diff
Diff the diff — compare two commit ranges (typically before vs after a rebase).
**Flags**: `base..old base..new` two ranges

```bash
git range-diff main...dev main...dev-rebased
```

#### Branch matrix git show-branch
Tabular view of which commits each branch contains.
**Flags**: `-a` include remote branches · `branch...` specific branches

```bash
git show-branch -a
```

#### Find unmerged commits git cherry
List commits on the current branch that are not present on an upstream.
**Flags**: `upstream` comparison target · `-v` show subjects

```bash
git cherry -v main
```

### Branching and integration

#### Cherry-pick git cherry-pick
Copy one commit from another branch onto the current branch.
**Flags**: `-x` record the source SHA · `-n` apply without committing · `--continue / --abort` after conflicts

```bash
git cherry-pick 9bb416d
git cherry-pick A^..B            # several commits in the (A, B] range
```

#### Revert git revert
Safely undo a commit with a new inverse commit (no history rewrite — safe on shared branches).
**Flags**: `-n` stage without committing · `-m 1` pick the mainline parent when reverting a merge

```bash
git revert 9bb416d
git revert -m 1 2e5be4f          # undo a bad merge
```

#### Multiple working trees git worktree
Check out several working directories of one repository at the same time.
**Flags**: `add path branch` add one · `list` list · `remove` remove

```bash
git worktree add ../todo-app-hotfix hotfix/urgent
git worktree list
```

#### External merge tools git mergetool
Invoke a configured external tool to resolve conflicts.
**Flags**: `-t tool` pick a tool · `--tool-help` list available tools

```bash
git mergetool -t vscode
```

#### Reuse conflict resolutions git rerere
Remember resolved conflicts and replay them automatically.
**Flags**: `status` show the records · `forget path` forget one file (needs rerere.enabled)

```bash
git config --global rerere.enabled true
```

#### Find the common ancestor git merge-base
Compute the most recent common ancestor of two branches.
**Flags**: `-a` all candidates · `--is-ancestor` ancestry test for scripts

```bash
git merge-base main dev
git merge-base --is-ancestor v1.0.0 main && echo contained
```

### Remotes and sync

#### List remote refs git ls-remote
List branches and tags on a remote without fetching objects.
**Flags**: `--heads` branches only · `--tags` tags only · `pattern` filter

```bash
git ls-remote --heads https://github.com/gitter-demo/todo-app.git
```

#### Nested repositories git submodule
Embed one repository inside another.
**Flags**: `add url path` add one · `update --init` fetch submodules · `foreach` run in each

```bash
git submodule add https://github.com/gitter-demo/lib-utils.git libs/utils
git clone --recurse-submodules https://github.com/gitter-demo/todo-app.git
git submodule update --init --recursive
```

#### Merge into a subdirectory git subtree
Fold another repository into a subdirectory (or split it out) — transparent to collaborators.
**Flags**: `add --prefix=dir url` fold in · `pull / push` sync · `--squash` without history

```bash
git subtree add  --prefix=libs/utils --squash https://github.com/gitter-demo/lib-utils.git main
git subtree pull --prefix=libs/utils --squash https://github.com/gitter-demo/lib-utils.git main
```

#### Summarize for a pull request git request-pull
Produce a "please pull from xx" summary (commits + diffstat) for e-mail collaboration.
**Flags**: `basepoint url endpoint` comparison range and repository

```bash
git request-pull main https://github.com/wyndam/todo-app.git feature/login
```

### Packaging and archiving

#### Export an archive git archive
Export the content of a commit or tag as zip/tar (without .git).
**Flags**: `--format=zip` format · `-o file` output

```bash
git archive --format=zip -o todo-app-v1.0.0.zip v1.0.0
```

#### Ship a repository offline git bundle
Pack a branch with its objects into a single file usable as a remote (offline / USB transfer).
**Flags**: `create file branch` pack · `verify` validate · `clone bundle dir` clone from it

```bash
git bundle create todo-app.bundle main
git clone todo-app.bundle todo-app-offline
```

#### Read a tar commit ID git get-tar-commit-id
Extract the commit SHA from a tar stream produced by git archive.
**Flags**: reads the tar stream on stdin, no command-line arguments

```bash
cat todo-app.tar | git get-tar-commit-id
```

### Patches and collaboration

#### Export patches git format-patch
Export commits as e-mail-format patch files with metadata.
**Flags**: `-n` last n commits · `A..B` range · `-o dir` output directory

```bash
git format-patch main -o patches/     # everything dev has beyond main
```

#### Apply patch commits git am
Apply format-patch patches, keeping authorship and messages as commits.
**Flags**: `patch...` files · `-3` fall back to a three-way merge · `--abort` bail out

```bash
git am patches/0001-*.patch
```

#### Apply a diff git apply
Apply a plain diff or patch (no commit is created).
**Flags**: `--stat` preview · `--check` validate only · `-R` reverse apply

```bash
git apply --check fix.diff && git apply fix.diff
```

#### Fingerprint a patch git patch-id
Compute a stable patch fingerprint to recognise the same change across branches.
**Flags**: `--stable` stable algorithm; diff comes from stdin

```bash
git show 9bb416d | git patch-id --stable
```

#### Send patches by e-mail git send-email
Send patches over SMTP (requires an SMTP setup).
**Flags**: `--to / --cc` recipients · `--compose` add a cover letter

```bash
git send-email patches/*.patch --to dev@example.com
```

#### Split mail patches git mailinfo / git mailsplit
Split an e-mail patch into headers and body, or into single files (the machinery behind am).
**Flags**: mailinfo `header-body files`; mailsplit `-o dir` output directory

```bash
git mailsplit -o mails/ < inbox.mbox
```

#### Manage trailers git interpret-trailers
Parse or append commit-message trailers such as Signed-off-by.
**Flags**: `--trailer "key=value"` append · `--parse` extract only

```bash
git interpret-trailers --trailer "Signed-off-by: wyndam <wyndam@example.com>" msg.txt
```

### Undoing and cleaning up

#### Remove untracked files git clean
Delete untracked files (refuses to run without -n or -f).
**Flags**: `-n` dry run · `-f` execute · `-d` include directories · `-x` include ignored files

```bash
git clean -nd          # preview first
git clean -fd          # delete untracked files and directories
```

#### Remove files git rm
Remove a file from version control (and the working tree).
**Flags**: `--cached` remove from the index only, keep the file · `-r` recurse into directories

```bash
git rm --cached secret.local       # stop tracking, keep the file
git rm -r legacy/
```

#### Move and rename git mv
Move or rename a tracked file (equivalent to mv + rm + add).
**Flags**: `-f` overwrite an existing target

```bash
git mv src/app.ts src/main.ts
```

#### Swap objects git replace
Replace one object with another — a correction tool that leaves original history untouched.
**Flags**: `old new` create a replacement · `-d` delete one · `--graft commit` change a parent

```bash
git replace 9bb416d 2e5be4f
git replace -d 9bb416d
```

### Maintenance and diagnostics

#### Compact the object store git gc
Pack loose objects, remove unreachable ones, and optimise packs.
**Flags**: `--prune=time` prune cutoff · `--aggressive` deep optimisation (slow) · `--auto` threshold based

```bash
git gc
git gc --prune=now --aggressive       # an occasional manual deep clean
```

#### Check repository integrity git fsck
Check the object store and find dangling objects.
**Flags**: `--lost-found` write dangling objects to disk · `--unreachable` list unreachable objects

```bash
git fsck --lost-found
```

#### Object statistics git count-objects
Report object counts and sizes.
**Flags**: `-v` verbose · `-H` human-readable

```bash
git count-objects -vH
```

#### Repack git repack
Repack loose objects into pack files.
**Flags**: `-d` delete redundant packs afterwards · `-a` put everything in one pack

```bash
git repack -ad
```

#### Prune unreachable objects git prune
Delete all unreachable objects (one of gc's jobs).
**Flags**: `-n` dry run · `--expire time` only prune older than this

```bash
git prune --expire 30.days.ago
```

#### Prune packed loose objects git prune-packed
Delete loose objects that are already contained in a pack.
**Flags**: `-n` dry run

```bash
git prune-packed
```

#### Background maintenance git maintenance
Register or run scheduled maintenance tasks (gc, commit-graph, prefetch, ...).
**Flags**: `start` register background tasks · `run --task=task` run one now

```bash
git maintenance start
git maintenance run --task=gc
```

#### Commit graph file git commit-graph
Build a commit graph file that speeds up history traversal (log and friends).
**Flags**: `write` generate · `--reachable` cover all refs · `verify` validate

```bash
git commit-graph write --reachable
```

#### Index many packs git multi-pack-index
Build a single index over multiple pack files to speed up large repositories.
**Flags**: `write` generate · `--bitmap` include bitmaps · `verify` validate

```bash
git multi-pack-index write
```

#### Pack refs git pack-refs
Bundle scattered refs into a single file.
**Flags**: `--all` include all branches · `--prune` clean up packed loose refs

```bash
git pack-refs --all --prune
```

#### Validate a pack git verify-pack
Check pack file integrity and object statistics.
**Flags**: `-v` verbose (sorted by size) · `-s` short form

```bash
git verify-pack -v .git/objects/pack/*.idx
```

#### Collect diagnostic data git bugreport
Gather version and environment information into a bug-report skeleton.
**Flags**: `-o dir` output directory · `-s prefix` file name prefix

```bash
git bugreport
```

#### Browse locally in a browser git instaweb
Start a local web server that browses the repository (needs CGI support).
**Flags**: `--httpd=server` pick a server · `--stop` stop it

```bash
git instaweb --httpd=webrick
git instaweb --stop
```

### Server-side and protocol

Useful for self-hosting Git or low-level transport; rarely touched in day-to-day local development.

#### Serve read-only repos git daemon
Serve read-only repositories over the git:// protocol.
**Flags**: `--export-all` export everything without markers · `--base-path=dir` repository root · `--port=port`

```bash
git daemon --base-path=/srv/git --export-all
```

#### Restricted login shell git shell
A restricted shell that only allows git transfer commands (for server accounts).
**Flags**: `-c "command"` run a restricted command; interactive use shows help

```bash
git shell -c "git-upload-pack '/gitter-demo/todo-app.git'"
```

#### Smart HTTP over CGI git http-backend
Provide the smart HTTP protocol as a CGI binary (behind nginx/Apache).
**Flags**: configured through GIT_PROJECT_ROOT / GIT_HTTP_EXPORT_ALL environment variables

```bash
GIT_PROJECT_ROOT=/srv/git GIT_HTTP_EXPORT_ALL=1 git http-backend
```

#### Low-level HTTP transport git http-fetch / git http-push
The HTTP transport pair of the dumb-protocol era, mostly superseded by smart HTTP.
**Flags**: `commit url` target and address · `-w` write refs back (push)

```bash
git http-fetch 9bb416d https://github.com/gitter-demo/todo-app.git
```

#### Transport internals git fetch-pack / send-pack / receive-pack / upload-pack
The underlying fetch/push implementations: client-side fetch-pack/send-pack negotiate with server-side upload-pack/receive-pack and transfer packed objects.
**Flags**: `--all` all refs · `--thin` thin pack; servers usually invoke these automatically over ssh/http

```bash
git upload-pack --advertise-refs .      # inspect advertised refs (debugging)
git fetch-pack --all ./
```

#### Serve dumb HTTP git update-server-info
Generate info/refs helper files for dumb-protocol HTTP serving.
**Flags**: `-f` force rewrite

```bash
git update-server-info
```

### Miscellaneous utilities

#### Partial checkout git sparse-checkout
Check out only part of a repository (monorepo productivity).
**Flags**: `init` enable · `set dirs...` set the set · `list` list · `disable` turn off

```bash
git sparse-checkout set --cone packages/web packages/sdk
```

#### Stage synonym git stage
A pure synonym for git add.
**Flags**: identical to git add

```bash
git stage src/app.ts
```

#### Read logical variables git var
Read Git's logical variables (editor, pager, ...).
**Flags**: `-l` list all · `variable` read one

```bash
git var GIT_EDITOR
```

#### Verify signatures git verify-commit / git verify-tag
Verify the GPG signature of a commit or a tag.
**Flags**: `-v` show signature details · `--raw` machine-readable output

```bash
git verify-commit 9bb416d
git verify-tag v1.0.0
```

#### Normalize identities git check-mailmap
Map names and e-mails to canonical identities according to mailmap rules.
**Flags**: `contact...` items to map

```bash
git check-mailmap "wyndam <wyndam@example.com>"
```

#### Built-in GUI git gui / git citool
The bundled Tcl/Tk graphical commit interface (citool exits right after committing).
**Flags**: `--amend` enter amend mode

```bash
git citool
```

#### Documentation git help
Show command documentation (equivalent to git command --help).
**Flags**: `-g` concept guides · `-a` list every command · `command` a specific command

```bash
git help rebase
```

### Plumbing — objects and refs

Plumbing: low-level interfaces for scripts and tools, not for interactive use.

#### Read an object git cat-file
Print an object's content, type, or size.
**Flags**: `-t / -s` type/size · `-p` pretty print

```bash
git cat-file -p HEAD^{tree}
```

#### Hash content git hash-object
Compute a blob hash (optionally writing it to the object store).
**Flags**: `-w` write to the store · `--stdin` read from stdin

```bash
echo hello | git hash-object --stdin
```

#### List index entries git ls-files
List the files in the index.
**Flags**: `-s` status mode · `--others` untracked · `--ignored` ignored

```bash
git ls-files --others --exclude-standard    # untracked file list
```

#### List tree contents git ls-tree
List the entries of a tree object (mode / type / name).
**Flags**: `-r` recursive · `-t` include trees themselves · `-l` append object sizes

```bash
git ls-tree -r v1.0.0 --name-only
```

#### Resolve a rev git rev-parse
Resolve any ref or expression to a SHA, and query repository info.
**Flags**: `--verify` strict check · `--short` short SHA · `--show-toplevel` repository root

```bash
git rev-parse --short HEAD
git rev-parse --show-toplevel
```

#### List a commit set git rev-list
List a set of reachable commits under conditions (the machinery behind log).
**Flags**: `--count` count only · `--left-right` side markers · `A..B` range

```bash
git rev-list --count main..dev
```

#### Symbolic refs git symbolic-ref
Read and write symbolic refs (e.g. which branch HEAD points at).
**Flags**: `ref` read · `ref target` set · `--short` short name

```bash
git symbolic-ref --short HEAD       # current branch name
git symbolic-ref HEAD refs/heads/main
```

#### Write a ref git update-ref
Write a ref safely, with transactions and old-value checks.
**Flags**: `-d` delete · `--no-deref` don't dereference · pass an old value for CAS checks

```bash
git update-ref refs/heads/dev 9bb416d
```

#### Walk refs git for-each-ref
List every ref in a given format (the machinery behind branch/tag listings).
**Flags**: `--format=template` output format · `--count=n` number of entries · `--sort=key` ordering

```bash
git for-each-ref --format="%(refname:short) %(objectname:short)" refs/heads/
```

#### Mutate the index git update-index
Operate on index entries directly (add/remove/assume-unchanged and friends).
**Flags**: `--add / --remove` register/delete · `--assume-unchanged` ignore changes · `--refresh` refresh

```bash
git update-index --assume-unchanged config.local
```

#### Write a tree from the index git write-tree
Write a tree object from the current index and return its SHA.
**Flags**: `--missing-ok` allow missing objects · `--prefix=dir` write only a subtree

```bash
TREE=$(git write-tree)
```

#### Read a tree into the index git read-tree
Read a tree object into the index (working tree untouched).
**Flags**: `-u` update the working tree · `-m` merge mode · `--prefix=dir` read into a subpath

```bash
git read-tree --prefix=lib/ -u lib-utils-main
```

#### Build a tree object git mktree
Build a tree object from ls-tree formatted lines on stdin.
**Flags**: `-z` NUL-delimited input · `--missing` allow missing objects

```bash
git ls-tree HEAD | git mktree
```

#### Build a tag object git mktag
Create and validate a tag object from its on-wire format.
**Flags**: content comes from stdin, no command-line arguments

```bash
git mktag < signed-tag.txt
```

#### Build a commit object git commit-tree
Create a commit object from a tree (the machinery behind commit).
**Flags**: `-p parent` parent commits (repeatable) · `-m message` commit message

```bash
git commit-tree $TREE -p HEAD -m "snapshot"
```

#### Materialize the index git checkout-index
Copy the index contents out to the working tree in bulk (export / deployment).
**Flags**: `-a` all entries · `--prefix=dir` output prefix

```bash
git checkout-index -a --prefix=/tmp/export/
```

### Plumbing — diff, merge and packing

#### Compare two trees git diff-tree
Diff two tree objects.
**Flags**: `-r` recursive · `--name-only` file names only · `--stdin` read commits from stdin

```bash
git diff-tree -r --name-only 9bb416d 2e5be4f
```

#### Diff against the index git diff-index
Diff a tree against the index (--cached) or the working tree.
**Flags**: `--cached` compare only the index · `-p` emit a patch

```bash
git diff-index --cached HEAD
```

#### Diff the working tree git diff-files
Diff the index against the working tree (the machinery behind git diff).
**Flags**: `-p` emit a patch

```bash
git diff-files -p
```

#### Three-way file merge git merge-file
Merge two files relative to a common base into the first file.
**Flags**: `-p` print instead of modifying · `--ours / --theirs` pick a side for conflicts

```bash
git merge-file current.txt base.txt other.txt
```

#### Scripted index merge git merge-index
Invoke a merge script per conflicted file in the index.
**Flags**: `script -a` run against every conflicted file

```bash
git merge-index git-merge-one-file -a
```

#### Default merge message git fmt-merge-msg
Generate a default merge commit message from a list of refs.
**Flags**: `--log` append the commit list; ref lines come from stdin

```bash
git fmt-merge-msg --log < .git/FETCH_HEAD
```

#### Query attributes git check-attr
Check which gitattributes rules apply to a path.
**Flags**: `-a` all attributes · `attr... path...` specific attributes and paths

```bash
git check-attr -a -- src/app.ts
```

#### Query ignores git check-ignore
Check whether gitignore rules match a path (debugging ignores).
**Flags**: `-v` show the matching rule line

```bash
git check-ignore -v build/output.js
```

#### Create a pack git pack-objects
Pack the objects in a given list.
**Flags**: `--revs` derive the set from rev arguments · `--stdout` write to stdout

```bash
git rev-list --objects --all | git pack-objects pack_NAME
```

#### Index a pack git index-pack
Build an .idx file for an existing pack.
**Flags**: `-o idx` output path · `--stdin` read from stdin

```bash
git index-pack -o pack.idx pack.pack
```

#### Unpack a pack git unpack-objects
Expand a pack file into loose objects.
**Flags**: `-n` dry run; the pack comes from stdin

```bash
git unpack-objects < pack.pack
```

#### Extract one object git unpack-file
Write a single blob to a temporary file and print its path.
**Flags**: `blob` object SHA

```bash
git unpack-file 9bb416d
```

#### Stream history out git fast-export
Export history as a stream format that scripts can process.
**Flags**: `--all` all refs · `--signed-tags=strip` signature handling

```bash
git fast-export --all > repo.dump
```

#### Stream history in git fast-import
Import history from a fast-export stream (the common backend for migration tools).
**Flags**: `--quiet` silent; the stream comes from stdin

```bash
git fast-import < repo.dump
```

### VCS bridges

#### Subversion bridge git svn
Two-way sync with a Subversion repository.
**Flags**: `clone svn-url` clone · `dcommit` push back · `rebase` pull

```bash
git svn clone https://example.com/svn/todo-app -T trunk
git svn rebase && git svn dcommit
```

#### Perforce bridge git p4
Two-way sync with a Perforce depot.
**Flags**: `clone //depot/path` clone · `submit` push back · `rebase` pull

```bash
git p4 clone //depot/project@all
git p4 rebase && git p4 submit
```

## 4. Appendix — alphabetical index

The complete command list, alphabetically, for quick lookup; flags and examples live in the category sections above.

| Command | One-liner | Section |
| --- | --- | --- |
| git add | Stage changes | 2 |
| git am | Apply mail patches as commits | 3 · Patches and collaboration |
| git apply | Apply a diff / patch | 3 · Patches and collaboration |
| git archive | Export a zip/tar archive for a commit | 3 · Packaging and archiving |
| git bisect | Binary search for a bad commit | 3 · Inspect and history |
| git blame | Trace each line back to its commit | 3 · Inspect and history |
| git branch | Manage branches | 2 |
| git bundle | Pack a repository into a single file | 3 · Packaging and archiving |
| git bugreport | Collect diagnostic information | 3 · Maintenance and diagnostics |
| git check-attr | Query gitattributes for a path | 3 · Plumbing — diff, merge and packing |
| git check-ignore | Check gitignore matches | 3 · Plumbing — diff, merge and packing |
| git check-mailmap | Normalize identities via mailmap | 3 · Miscellaneous utilities |
| git cherry | List commits not on an upstream | 3 · Inspect and history |
| git cherry-pick | Copy one commit over | 3 · Branching and integration |
| git citool | Graphical commit (quit after commit) | 3 · Miscellaneous utilities |
| git clean | Delete untracked files | 3 · Undoing and cleaning up |
| git clone | Copy a remote repository | 2 |
| git checkout | Restore files / switch | 2 |
| git checkout-index | Materialize the index to disk | 3 · Plumbing — objects and refs |
| git commit | Create a commit | 2 |
| git commit-graph | Build a commit graph file | 3 · Maintenance and diagnostics |
| git commit-tree | Build a commit object | 3 · Plumbing — objects and refs |
| git config | Read and write configuration | 1 |
| git count-objects | Object counts and sizes | 3 · Maintenance and diagnostics |
| git daemon | Serve repos over git:// | 3 · Server-side and protocol |
| git describe | Derive a version from a tag | 3 · Inspect and history |
| git diff | Compare changes | 2 |
| git diff-files | Index vs working tree | 3 · Plumbing — diff, merge and packing |
| git diff-index | Tree vs index / working tree | 3 · Plumbing — diff, merge and packing |
| git diff-tree | Tree vs tree | 3 · Plumbing — diff, merge and packing |
| git fetch | Download from a remote | 2 |
| git fetch-pack | Low-level fetch transport | 3 · Server-side and protocol |
| git fast-export | Stream history out | 3 · Plumbing — diff, merge and packing |
| git fast-import | Stream history in | 3 · Plumbing — diff, merge and packing |
| git fmt-merge-msg | Default merge message | 3 · Plumbing — diff, merge and packing |
| git format-patch | Export patches | 3 · Patches and collaboration |
| git for-each-ref | List refs in a format | 3 · Plumbing — objects and refs |
| git fsck | Check integrity | 3 · Maintenance and diagnostics |
| git gc | Compact and prune | 3 · Maintenance and diagnostics |
| git get-tar-commit-id | Read a commit ID from a tar stream | 3 · Packaging and archiving |
| git grep | Search tracked content | 3 · Inspect and history |
| git gui | Graphical commit interface | 3 · Miscellaneous utilities |
| git hash-object | Hash content | 3 · Plumbing — objects and refs |
| git help | Command documentation | 3 · Miscellaneous utilities |
| git http-backend | Smart HTTP CGI | 3 · Server-side and protocol |
| git http-fetch | Low-level HTTP fetch | 3 · Server-side and protocol |
| git http-push | Low-level HTTP push | 3 · Server-side and protocol |
| git init | Initialize a repository | 1 |
| git index-pack | Index a pack file | 3 · Plumbing — diff, merge and packing |
| git instaweb | Browse locally in a browser | 3 · Maintenance and diagnostics |
| git interpret-trailers | Parse / append trailers | 3 · Patches and collaboration |
| git log | Show history | 2 |
| git ls-files | List index entries | 3 · Plumbing — objects and refs |
| git ls-remote | List remote refs | 3 · Remotes and sync |
| git ls-tree | List tree contents | 3 · Plumbing — objects and refs |
| git mailinfo | Split a patch's header and body | 3 · Patches and collaboration |
| git mailsplit | Split an mbox into files | 3 · Patches and collaboration |
| git maintenance | Scheduled maintenance tasks | 3 · Maintenance and diagnostics |
| git merge | Merge branches | 2 |
| git merge-base | Common ancestor | 3 · Branching and integration |
| git merge-file | Three-way file merge | 3 · Plumbing — diff, merge and packing |
| git merge-index | Scripted index merge | 3 · Plumbing — diff, merge and packing |
| git mergetool | External merge tool | 3 · Branching and integration |
| git mktree | Build a tree object | 3 · Plumbing — objects and refs |
| git mktag | Build a tag object | 3 · Plumbing — objects and refs |
| git mv | Move and rename tracked files | 3 · Undoing and cleaning up |
| git multi-pack-index | Index many packs | 3 · Maintenance and diagnostics |
| git p4 | Perforce bridge | 3 · VCS bridges |
| git pack-objects | Create a pack | 3 · Plumbing — diff, merge and packing |
| git pack-refs | Pack refs into one file | 3 · Maintenance and diagnostics |
| git patch-id | Patch fingerprint | 3 · Patches and collaboration |
| git pull | Fetch and merge | 2 |
| git prune | Delete unreachable objects | 3 · Maintenance and diagnostics |
| git prune-packed | Delete packed loose objects | 3 · Maintenance and diagnostics |
| git push | Upload commits | 2 |
| git read-tree | Read a tree into the index | 3 · Plumbing — objects and refs |
| git receive-pack | Server-side push receiver | 3 · Server-side and protocol |
| git reflog | Ref movement history | 3 · Inspect and history |
| git remote | Manage remotes | 2 |
| git repack | Repack objects | 3 · Maintenance and diagnostics |
| git replace | Object replacement | 3 · Undoing and cleaning up |
| git request-pull | Pull-request summary | 3 · Remotes and sync |
| git rerere | Reuse conflict resolutions | 3 · Branching and integration |
| git reset | Move HEAD / branch | 2 |
| git restore | Restore working tree / index | 2 |
| git rev-list | List a commit set | 3 · Plumbing — objects and refs |
| git rev-parse | Resolve a ref | 3 · Plumbing — objects and refs |
| git revert | Revert a commit | 3 · Branching and integration |
| git rm | Remove files | 3 · Undoing and cleaning up |
| git send-email | Send patches by e-mail | 3 · Patches and collaboration |
| git send-pack | Low-level push | 3 · Server-side and protocol |
| git shell | Restricted login shell | 3 · Server-side and protocol |
| git shortlog | Summarize by author | 3 · Inspect and history |
| git show | Show an object | 3 · Inspect and history |
| git show-branch | Branch coverage matrix | 3 · Inspect and history |
| git sparse-checkout | Partial checkout | 3 · Miscellaneous utilities |
| git stage | Synonym for add | 3 · Miscellaneous utilities |
| git stash | Shelve changes | 2 |
| git status | Check status | 2 |
| git submodule | Manage submodules | 3 · Remotes and sync |
| git subtree | Fold a repo into a subdirectory | 3 · Remotes and sync |
| git switch | Switch branches | 2 |
| git svn | Subversion bridge | 3 · VCS bridges |
| git symbolic-ref | Read / write symbolic refs | 3 · Plumbing — objects and refs |
| git tag | Manage tags | 2 |
| git unpack-file | Extract one blob | 3 · Plumbing — diff, merge and packing |
| git unpack-objects | Unpack a pack | 3 · Plumbing — diff, merge and packing |
| git update-index | Mutate index entries | 3 · Plumbing — objects and refs |
| git update-ref | Write a ref | 3 · Plumbing — objects and refs |
| git update-server-info | Dumb-protocol helper files | 3 · Server-side and protocol |
| git upload-archive | Server-side archive service | 3 · Server-side and protocol |
| git upload-pack | Server-side fetch service | 3 · Server-side and protocol |
| git var | Read a logical variable | 3 · Miscellaneous utilities |
| git verify-commit | Verify a commit signature | 3 · Miscellaneous utilities |
| git verify-pack | Validate a pack | 3 · Maintenance and diagnostics |
| git verify-tag | Verify a tag signature | 3 · Miscellaneous utilities |
| git worktree | Multiple working trees | 3 · Branching and integration |
| git write-tree | Write a tree from the index | 3 · Plumbing — objects and refs |
