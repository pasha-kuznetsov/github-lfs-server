## Authenticate

## Recommended: use [`gh`](https://cli.github.com/)

Configure gh as your Git credential helper for Github:

```sh
gh auth setup-git
```

And the same for your LFS server, too:

```sh
gh auth setup-git -h '<lfs-server.your-domain>'
```

This command automatically configures your global .gitconfig to use gh as the credential helper for all GitHub operations.

### Manual steps if needed

Authenticate to `gh`
```sh
gh auth login -h '<lfs-server.your-domain>'
```

Follow the prompts. When asked for your preferred protocol, select HTTPS, and when asked if you would like to authenticate to Git, select Yes.

```sh
git config set 'credential.https://gist.github.com.helper' '!gh auth git-credential'
```

### Or: [`git-credential-manager`](https://github.com/git-ecosystem/git-credential-manager/blob/release/docs/install.md)

```sh
git-credential-manager configure
git config --global 'credential.https://<lfs-server.your-domain>.provider' github
```

### Or: generate and use Github personal token

Use your GitHub id and personal access token. Here's how to get one:
* **Navigate to Settings:** Log in to GitHub, click your profile picture in the top-right, and select Settings.
* **Developer Settings:** Scroll down on the left sidebar and click Developer settings.
* **Personal Access Tokens:** Click Personal access tokens, then choose either Fine-grained tokens or Tokens (classic).
* **Generate Token:** Click Generate new token.
  - **Configure:** Give it a descriptive Note or name.
  - **Set an Expiration date** (GitHub recommends not setting it to "never" for security).
  - **Select the Scopes or permissions.** For basic command-line use like pushing code, ensure you check the repo box.
  - **Copy and Save:** Click Generate token and **immediately copy the token**. GitHub will never show it to you again once you leave the page.

### Provide access to your organization

* **All repositories** (or control via _Only select repositories_)
* **Add Permissions:** click `Add permissions`
  * **Contents:**
  * **Contents: Access: Read and write** 
  * **Metadata:** this isn't used, feel free to leave as is

## Tracking files

```sh
git lfs track "*.iso"
```
