TOOLS_IMAGE = "denoland/deno:alpine"
TOOLS_ARGS = '--volume /var/run/docker.sock:/var/run/docker.sock --volume /tmp:/tmp'


pipeline {
  agent {
    label 'ec2-large'
  }

  triggers {
    pollSCM( '* * * * *')
    cron( 'H H(2-3) * * H(2-4)') // UTC About Midday Sydney time on a workday.
  }

  options {
    timeout(time: 1, unit: 'HOURS')
    disableConcurrentBuilds()
    parallelsAlwaysFailFast()
  }

  stages {
    agent {
        docker {
          image TOOLS_IMAGE
          args TOOLS_ARGS
        }
      }
    stage('Build') {
      steps {

        sh '''\
            #!/bin/bash
            set -ex
            pwd
            ls -l 
            
            deno test --allow-all test/*
        '''.stripIndent()
      }
    }
  }
}
